"""
Full EMU spacesuit (EV1, red stripes) for the third-person spacewalk cutscenes.
Run headless:  blender -b -P scripts/blender/emu_suit.py -- out.glb [preview.png]

Rigid, posable hierarchy (no skinning): every limb hangs from a joint node so the game can aim arms and legs.
Blender: Z up, astronaut faces +Y (three.js: Y up, faces -Z, like the helmet camera). Feet at z = 0, eyes ≈ z 1.66.
Joints: jTorso (waist) > jShoulderL/R > jElbowL/R > jWristL/R ; jHipL/R > jKneeL/R.  Limbs rest pointing down (-Z).
Materials by name for the game: suit, hard, chrome, ano, visor, glass, stripe, grey, dark, lens.
"""
import bpy, bmesh, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'emu_suit.glb'
PREVIEW = argv[1] if len(argv) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COL = {'suit': (0.93, 0.92, 0.89), 'hard': (0.95, 0.95, 0.94), 'chrome': (0.85, 0.86, 0.88), 'ano': (0.7, 0.12, 0.12), 'visor': (0.95, 0.72, 0.25),
       'glass': (0.05, 0.06, 0.08), 'stripe': (0.75, 0.08, 0.08), 'grey': (0.55, 0.56, 0.58), 'dark': (0.08, 0.08, 0.09), 'lens': (1.0, 0.97, 0.9)}
MATS = {}
for n, c in COL.items():
    m = bpy.data.materials.new(n); m.diffuse_color = (*c, 1); MATS[n] = m


def link(o):
    scene.collection.objects.link(o); return o


def activate(o):
    for x in scene.objects: x.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o


def apply_mods(o):
    activate(o)
    for md in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=md.name)


def joint(name, loc, parent=None):
    e = link(bpy.data.objects.new(name, None))
    e.empty_display_size = 0.05
    e.location = loc
    if parent:
        e.parent = parent
        e.location = Vector(loc) - parent.matrix_world.translation
    bpy.context.view_layer.update()
    return e


def attach(o, parent):
    mw = o.matrix_world.copy(); o.parent = parent; bpy.context.view_layer.update(); o.matrix_world = mw


def finish(o, mat, smooth=True, sub=0):
    if sub:
        s = o.modifiers.new('sub', 'SUBSURF'); s.levels = sub
        apply_mods(o)
    o.data.materials.clear(); o.data.materials.append(MATS[mat])
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    return o


def lathe(name, prof, mat, top, axis_down=True, seg=48, rings=None):
    """Tube along -Z from `top`: prof = [(dist, radius)]; rings = [(dist, bump)] convolute bearing bumps."""
    me = bpy.data.meshes.new(name); o = link(bpy.data.objects.new(name, me))
    bm = bmesh.new(); rows = []
    steps = []
    d0, d1 = prof[0][0], prof[-1][0]
    n = 40
    for i in range(n + 1):
        d = d0 + (d1 - d0) * i / n
        for k in range(len(prof) - 1):
            if prof[k][0] <= d <= prof[k + 1][0]:
                t = (d - prof[k][0]) / max(prof[k + 1][0] - prof[k][0], 1e-6); r = prof[k][1] + (prof[k + 1][1] - prof[k][1]) * t; break
        for (c, b) in (rings or []):
            r += b * math.exp(-((d - c) / 0.012) ** 2)
        steps.append((d, r))
    for d, r in steps:
        rows.append([bm.verts.new((top[0] + math.cos(2 * math.pi * j / seg) * r, top[1] + math.sin(2 * math.pi * j / seg) * r, top[2] - d)) for j in range(seg)])
    for i in range(len(rows) - 1):
        for j in range(seg):
            bm.faces.new((rows[i][j], rows[i][(j + 1) % seg], rows[i + 1][(j + 1) % seg], rows[i + 1][j]))
    bm.faces.new(rows[0]); bm.faces.new(list(reversed(rows[-1])))
    bm.normal_update(); bm.to_mesh(me); bm.free()
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    return finish(o, mat)


def box(name, size, loc, mat, bevel=0.02, sub=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.active_object; o.name = name
    o.scale = size; apply_scale(o)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 3
    return finish(o, mat, True, sub if bevel else 0)


def apply_scale(o):
    activate(o); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def sphere(name, r, loc, mat, scale=(1, 1, 1), seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=seg // 2); o = bpy.context.active_object; o.name = name
    o.scale = scale; apply_scale(o)
    return finish(o, mat)


def cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=32, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts); o = bpy.context.active_object; o.name = name
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 2; apply_mods(o)
    return finish(o, mat)


def torus(name, R, r, loc, mat, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=48, minor_segments=10); o = bpy.context.active_object; o.name = name
    o.scale = scale; apply_scale(o)
    return finish(o, mat)


root = link(bpy.data.objects.new('EMU_Suit', None))
jT = joint('jTorso', (0, 0, 1.05), root)

# ── lower torso (brief) + body seal closure
lathe('brief', [(0, 0.17), (0.08, 0.185), (0.16, 0.17)], 'suit', (0, 0, 1.1)).scale = (1, 0.82, 1)
apply_scale(scene.objects['brief']); attach(scene.objects['brief'], root)
torus('waistRing', 0.17, 0.014, (0, 0, 1.1), 'chrome', scale=(1, 0.82, 1)); attach(scene.objects['waistRing'], jT)
# ── hard upper torso + chest DCM
hut = box('HUT', (0.5, 0.36, 0.42), (0, 0, 1.33), 'hard', 0.09, 2); attach(hut, jT)
dcm = box('DCM', (0.26, 0.09, 0.13), (0, 0.22, 1.32), 'grey', 0.015, 1); attach(dcm, jT)
for i, x in enumerate((-0.08, -0.025, 0.03, 0.085)):
    k = cyl(f'knob{i}', 0.014, 0.025, (x, 0.275, 1.34 + (0.03 if i % 2 else -0.02)), 'dark', rot=(math.pi / 2, 0, 0), verts=16); attach(k, jT)
disp = box('dcmDisplay', (0.08, 0.01, 0.035), (-0.06, 0.27, 1.37), 'glass', 0, 0); attach(disp, jT)
# ── PLSS backpack + SAFER + details
plss = box('PLSS', (0.52, 0.24, 0.68), (0, -0.31, 1.28), 'hard', 0.05, 2); attach(plss, jT)
safer = box('SAFER', (0.5, 0.2, 0.17), (0, -0.33, 0.86), 'grey', 0.03, 2); attach(safer, jT)
for x in (-0.2, 0.2):
    a = cyl(f'antenna{x}', 0.008, 0.18, (x, -0.38, 1.7), 'grey', verts=10); attach(a, jT)
for i in range(4):
    v = box(f'vent{i}', (0.36, 0.012, 0.018), (0, -0.432, 1.08 + i * 0.05), 'dark', 0, 0); attach(v, jT)
# ── helmet: neck ring, clear bubble, gold visor shell, EVVA lights + helmet cams
torus('neckRing', 0.13, 0.02, (0, 0.02, 1.52), 'chrome'); attach(scene.objects['neckRing'], jT)
helmet = sphere('helmet', 0.165, (0, 0.03, 1.66), 'glass'); attach(helmet, jT)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.172, location=(0, 0.03, 1.66), segments=64, ring_count=32)
vis = bpy.context.active_object; vis.name = 'visor'
bm = bmesh.new(); bm.from_mesh(vis.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < 0.03 or v.co.z < -0.11 or v.co.z > 0.12], context='VERTS')
bm.to_mesh(vis.data); bm.free(); finish(vis, 'visor'); attach(vis, jT)
shell = sphere('helmetShell', 0.178, (0, 0.0, 1.67), 'hard', scale=(1.0, 1.0, 1.0))
bm = bmesh.new(); bm.from_mesh(shell.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > -0.02 and v.co.z < 0.12], context='VERTS')
bm.to_mesh(shell.data); bm.free(); attach(shell, jT)
for s in (-1, 1):
    lamp = box(f'evva{s}', (0.06, 0.09, 0.05), (s * 0.17, 0.05, 1.71), 'grey', 0.01, 1); attach(lamp, jT)
    lens = cyl(f'lens{s}', 0.02, 0.01, (s * 0.17, 0.1, 1.71), 'lens', rot=(math.pi / 2, 0, 0), verts=20); attach(lens, jT)
    cam = cyl(f'hcam{s}', 0.012, 0.05, (s * 0.17, 0.08, 1.665), 'dark', rot=(math.pi / 2, 0, 0), verts=16); attach(cam, jT)

# ── arms: shoulder bearing > upper arm > elbow > lower arm > wrist disconnect > glove (mitt + thumb)
for s, nm in ((1, 'R'), (-1, 'L')):
    sx = 0.29 * s
    jS = joint(f'jShoulder{nm}', (sx, 0, 1.43), jT)
    torus(f'shBearing{nm}', 0.082, 0.016, (sx, 0, 1.43), 'chrome', rot=(0, math.pi / 2, 0)); attach(scene.objects[f'shBearing{nm}'], jT)
    up = lathe(f'upperArm{nm}', [(0, 0.082), (0.15, 0.078), (0.3, 0.072)], 'suit', (sx, 0, 1.43), rings=[(0.08, 0.006), (0.16, 0.006), (0.24, 0.006)]); attach(up, jS)
    jE = joint(f'jElbow{nm}', (sx, 0, 1.13), jS)
    lo = lathe(f'lowerArm{nm}', [(0, 0.07), (0.14, 0.066), (0.26, 0.06)], 'suit', (sx, 0, 1.13), rings=[(0.05, 0.007), (0.12, 0.006), (0.19, 0.006)]); attach(lo, jE)
    jW = joint(f'jWrist{nm}', (sx, 0, 0.87), jE)
    cyl(f'wristRing{nm}', 0.058, 0.025, (sx, 0, 0.865), 'ano'); attach(scene.objects[f'wristRing{nm}'], jW)
    palm = sphere(f'glove{nm}', 0.05, (sx, 0.005, 0.79), 'grey', scale=(0.95, 0.55, 1.5)); attach(palm, jW)
    th = sphere(f'thumb{nm}', 0.02, (sx - 0.04 * s, 0.03, 0.8), 'grey', scale=(0.9, 0.9, 2.0)); attach(th, jW)

# ── legs: hip bearing > thigh (red stripe = EV1) > knee > shin > boot
for s, nm in ((1, 'R'), (-1, 'L')):
    hx = 0.105 * s
    jH = joint(f'jHip{nm}', (hx, 0, 0.98), root)
    th = lathe(f'thigh{nm}', [(0, 0.1), (0.2, 0.094), (0.42, 0.085)], 'suit', (hx, 0, 0.98), rings=[(0.1, 0.007), (0.3, 0.007)]); attach(th, jH)
    for z in (0.86, 0.72):
        torus(f'stripe{nm}{z}', 0.098, 0.012, (hx, 0, z), 'stripe', scale=(1, 1, 1.6)); attach(scene.objects[f'stripe{nm}{z}'], jH)
    jK = joint(f'jKnee{nm}', (hx, 0, 0.56), jH)
    sh = lathe(f'shin{nm}', [(0, 0.084), (0.2, 0.078), (0.42, 0.07)], 'suit', (hx, 0, 0.56), rings=[(0.04, 0.008), (0.3, 0.006)]); attach(sh, jK)
    torus(f'stripeK{nm}', 0.086, 0.011, (hx, 0, 0.5), 'stripe', scale=(1, 1, 1.6)); attach(scene.objects[f'stripeK{nm}'], jK)
    boot = box(f'boot{nm}', (0.13, 0.3, 0.13), (hx, 0.05, 0.07), 'grey', 0.04, 2); attach(boot, jK)
    sole = box(f'sole{nm}', (0.13, 0.31, 0.025), (hx, 0.05, 0.005), 'dark', 0.008, 1); attach(sole, jK)
# waist tether reel (right hip)
reel = cyl('tetherReel', 0.05, 0.06, (0.22, 0.05, 1.02), 'grey', rot=(0, math.pi / 2, 0), verts=24, bevel=0.006); attach(reel, jT)

for o in scene.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_materials='EXPORT', export_animations=False)
print('EXPORTED', OUT, 'faces', sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH'))

if PREVIEW:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'MATERIAL'; scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 900, 1100
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.location = (2.2, 3.0, 1.5)
    cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 60; scene.camera = cam
    bpy.data.objects['jShoulderL'].rotation_euler = (1.2, 0, 0)
    bpy.data.objects['jElbowL'].rotation_euler = (0.5, 0, 0)
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
