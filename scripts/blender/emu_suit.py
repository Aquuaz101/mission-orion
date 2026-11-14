"""
Full EMU spacesuit (EV1, red stripes) for the third-person spacewalk cutscenes - soft-jointed version.
Run headless:  blender -b -P scripts/blender/emu_suit.py -- out.glb [preview.png]

The soft suit is ONE continuous skinned mesh (skeleton -> skin modifier -> subdivision), weighted to bones by
distance, so shoulders, elbows, hips and knees bend like pressurised fabric instead of rigid tubes. Hard parts
(HUT, PLSS + SAFER, DCM, helmet + gold visor, EVVA lights and cams, bearings, wrist disconnects, gloves, boots,
stripes, tether reel, convolute bands) ride on their bones.
Blender: Z up, faces +Y (three.js: Y up, faces -Z). Feet at z 0, eyes about z 1.66.
Bones: root > jTorso > jShoulderL/R > jElbowL/R > jWristL/R ; root > jHipL/R > jKneeL/R.
Materials: suit, hard, chrome, ano, visor, glass, stripe, grey, dark, lens.
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


def apply_scale(o):
    activate(o); bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def finish(o, mat, smooth=True, sub=0):
    if sub:
        s = o.modifiers.new('sub', 'SUBSURF'); s.levels = sub; apply_mods(o)
    o.data.materials.clear(); o.data.materials.append(MATS[mat])
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    return o


def box(name, size, loc, mat, bevel=0.02, sub=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.active_object; o.name = name
    o.scale = size; apply_scale(o)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 3
    return finish(o, mat, True, sub if bevel else 0)


def sphere(name, r, loc, mat, scale=(1, 1, 1), seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=seg // 2); o = bpy.context.active_object; o.name = name
    o.scale = scale; apply_scale(o); return finish(o, mat)


def cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=32, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts); o = bpy.context.active_object; o.name = name
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 2; apply_mods(o)
    return finish(o, mat)


def torus(name, R, r, loc, mat, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=48, minor_segments=10); o = bpy.context.active_object; o.name = name
    o.scale = scale; apply_scale(o); return finish(o, mat)


# ───────────────────────── skeleton points
P = {
    'pelvis': Vector((0, 0, 1.0)), 'spine': Vector((0, 0, 1.17)), 'chest': Vector((0, 0, 1.36)), 'neck': Vector((0, 0.02, 1.53)),
}
for s, nm in ((1, 'R'), (-1, 'L')):
    P['sh' + nm] = Vector((0.25 * s, 0, 1.43)); P['el' + nm] = Vector((0.3 * s, 0.02, 1.14)); P['wr' + nm] = Vector((0.31 * s, 0.04, 0.88)); P['ha' + nm] = Vector((0.31 * s, 0.05, 0.78))
    P['hip' + nm] = Vector((0.105 * s, 0, 0.98)); P['kn' + nm] = Vector((0.11 * s, 0.02, 0.56)); P['an' + nm] = Vector((0.11 * s, 0, 0.14))

# ───────────────────────── soft suit: skin modifier over the skeleton
me = bpy.data.meshes.new('softSuit'); body = link(bpy.data.objects.new('SoftSuit', me))
bm = bmesh.new(); rad = []; V = {}


def add(k, r, rz=None):
    V[k] = bm.verts.new(P[k]); rad.append((r, rz if rz else r))


add('pelvis', 0.18, 0.15); add('spine', 0.19, 0.15); add('chest', 0.2, 0.16); add('neck', 0.1)
for nm in 'LR':
    add('sh' + nm, 0.088); add('el' + nm, 0.075); add('wr' + nm, 0.06)
    add('hip' + nm, 0.105); add('kn' + nm, 0.088); add('an' + nm, 0.072)
E = [('pelvis', 'spine'), ('spine', 'chest'), ('chest', 'neck')]
for nm in 'LR':
    E += [('chest', 'sh' + nm), ('sh' + nm, 'el' + nm), ('el' + nm, 'wr' + nm), ('pelvis', 'hip' + nm), ('hip' + nm, 'kn' + nm), ('kn' + nm, 'an' + nm)]
for a, b in E: bm.edges.new((V[a], V[b]))
bm.to_mesh(me); bm.free()
sk = body.modifiers.new('skin', 'SKIN'); sk.use_smooth_shade = True
for i, sv in enumerate(me.skin_vertices[0].data): sv.radius = rad[i]
me.skin_vertices[0].data[0].use_root = True
sb = body.modifiers.new('sub', 'SUBSURF'); sb.levels = 2
apply_mods(body)
# fabric folds: gentle noise displacement
tex = bpy.data.textures.new('folds', 'CLOUDS'); tex.noise_scale = 0.06
dsp = body.modifiers.new('folds', 'DISPLACE'); dsp.texture = tex; dsp.strength = 0.006; dsp.mid_level = 0.5
apply_mods(body)
finish(body, 'suit')

# ───────────────────────── armature
ad = bpy.data.armatures.new('EMU_Body'); arm = link(bpy.data.objects.new('EMU_Body', ad))
activate(arm); bpy.ops.object.mode_set(mode='EDIT')
eb = ad.edit_bones
def bone(n, h, t, parent=None, roll_to=(0, 1, 0)):
    b = eb.new(n); b.head = h; b.tail = t; b.align_roll(Vector(roll_to))
    if parent: b.parent = eb[parent]
    return b
bone('root', P['pelvis'] + Vector((0, 0, -0.05)), P['pelvis'])
bone('jTorso', P['pelvis'], P['neck'], 'root')
for nm in 'LR':
    bone('jShoulder' + nm, P['sh' + nm], P['el' + nm], 'jTorso')
    bone('jElbow' + nm, P['el' + nm], P['wr' + nm], 'jShoulder' + nm)
    bone('jWrist' + nm, P['wr' + nm], P['ha' + nm], 'jElbow' + nm)
    bone('jHip' + nm, P['hip' + nm], P['kn' + nm], 'root')
    bone('jKnee' + nm, P['kn' + nm], P['an' + nm], 'jHip' + nm)
segs = {b.name: (b.head.copy(), b.tail.copy()) for b in eb}
bpy.ops.object.mode_set(mode='OBJECT')
# torso segment: count the shoulder yoke as torso
segs['jTorso'] = (P['pelvis'], P['neck'])


def seg_dist(p, a, b):
    ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared)); return (p - (a + ab * t)).length


groups = {n: body.vertex_groups.new(name=n) for n in segs if n != 'root'}
for v in body.data.vertices:
    p = v.co
    ds = sorted(((seg_dist(p, a, b), n) for n, (a, b) in segs.items() if n != 'root'))[:3]
    ws = [(1.0 / (d + 0.02) ** 4, n) for d, n in ds]
    tot = sum(w for w, _ in ws)
    for w, n in ws: groups[n].add([v.index], w / tot, 'REPLACE')
body.parent = arm
am = body.modifiers.new('arm', 'ARMATURE'); am.object = arm


def on_bone(o, bname):
    mw = o.matrix_world.copy(); o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = bname
    bpy.context.view_layer.update(); o.matrix_world = mw


# ───────────────────────── hard parts on bones
T = 'jTorso'
on_bone(box('HUT', (0.5, 0.36, 0.4), (0, 0, 1.34), 'hard', 0.09, 2), T)
on_bone(box('DCM', (0.26, 0.09, 0.13), (0, 0.22, 1.31), 'grey', 0.015, 1), T)
for i, (x, z) in enumerate(((-0.085, 1.29), (-0.03, 1.33), (0.025, 1.29), (0.085, 1.33))):
    on_bone(cyl(f'knob{i}', 0.014, 0.025, (x, 0.275, z), 'dark', rot=(math.pi / 2, 0, 0), verts=16), T)
on_bone(box('dcmDisplay', (0.09, 0.01, 0.035), (-0.05, 0.27, 1.355), 'glass', 0, 0), T)
on_bone(box('dcmLabel', (0.06, 0.006, 0.015), (0.06, 0.27, 1.36), 'stripe', 0, 0), T)
for s in (-1, 1):                                       # body-restraint tether hooks + waist bearing
    on_bone(torus(f'hook{s}', 0.022, 0.005, (0.17 * s, 0.17, 1.17), 'chrome', rot=(math.pi / 2, 0, 0)), T)
on_bone(torus('waistRing', 0.175, 0.014, (0, 0, 1.12), 'chrome', scale=(1, 0.84, 1)), T)
on_bone(box('PLSS', (0.52, 0.24, 0.68), (0, -0.31, 1.28), 'hard', 0.05, 2), T)
on_bone(box('SAFER', (0.5, 0.2, 0.17), (0, -0.33, 0.86), 'grey', 0.03, 2), T)
for s in (-1, 1):
    on_bone(box(f'saferHandle{s}', (0.04, 0.12, 0.03), (0.22 * s, -0.22, 0.86), 'dark', 0.008, 1), T)
    on_bone(cyl(f'antenna{s}', 0.008, 0.18, (0.2 * s, -0.38, 1.7), 'grey', verts=10), T)
for i in range(5):
    on_bone(box(f'vent{i}', (0.36, 0.012, 0.016), (0, -0.432, 1.05 + i * 0.045), 'dark', 0, 0), T)
on_bone(box('plssLabel', (0.2, 0.006, 0.05), (0, -0.432, 1.52), 'stripe', 0, 0), T)
# helmet: neck ring, clear bubble, sun visor shell (gold), protective shell, EVVA lights + cams
on_bone(torus('neckRing', 0.13, 0.02, (0, 0.02, 1.52), 'chrome'), T)
on_bone(sphere('helmet', 0.165, (0, 0.03, 1.66), 'glass'), T)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.172, location=(0, 0.03, 1.66), segments=64, ring_count=32)
vis = bpy.context.active_object; vis.name = 'visor'
bm = bmesh.new(); bm.from_mesh(vis.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < 0.03 or v.co.z < -0.11 or v.co.z > 0.12], context='VERTS')
bm.to_mesh(vis.data); bm.free(); finish(vis, 'visor'); on_bone(vis, T)
shell = sphere('helmetShell', 0.178, (0, 0.0, 1.67), 'hard')
bm = bmesh.new(); bm.from_mesh(shell.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > -0.02 and v.co.z < 0.12], context='VERTS')
bm.to_mesh(shell.data); bm.free(); on_bone(shell, T)
for s in (-1, 1):
    on_bone(box(f'evva{s}', (0.06, 0.09, 0.05), (s * 0.17, 0.05, 1.71), 'grey', 0.01, 1), T)
    on_bone(cyl(f'lens{s}', 0.02, 0.01, (s * 0.17, 0.1, 1.71), 'lens', rot=(math.pi / 2, 0, 0), verts=20), T)
    on_bone(cyl(f'hcam{s}', 0.012, 0.05, (s * 0.17, 0.08, 1.665), 'dark', rot=(math.pi / 2, 0, 0), verts=16), T)
on_bone(cyl('tetherReel', 0.05, 0.06, (0.22, 0.06, 1.02), 'grey', rot=(0, math.pi / 2, 0), verts=24, bevel=0.006), T)
on_bone(box('reelLabel', (0.005, 0.04, 0.02), (0.252, 0.06, 1.02), 'stripe', 0, 0), T)
# arms: shoulder bearings, convolute bands, wrist disconnects, gloves
for s, nm in ((1, 'R'), (-1, 'L')):
    on_bone(torus(f'shBearing{nm}', 0.088, 0.016, P['sh' + nm], 'chrome', rot=(0, math.pi / 2, 0)), T)
    a, b = P['sh' + nm], P['el' + nm]
    for t in (0.3, 0.55, 0.8):
        p = a.lerp(b, t); d = (b - a).normalized()
        o = torus(f'ua{nm}{t}', 0.081, 0.006, p, 'grey'); o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d); on_bone(o, 'jShoulder' + nm)
    a, b = P['el' + nm], P['wr' + nm]
    for t in (0.25, 0.55):
        p = a.lerp(b, t); d = (b - a).normalized()
        o = torus(f'la{nm}{t}', 0.07, 0.006, p, 'grey'); o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d); on_bone(o, 'jElbow' + nm)
    o = cyl(f'wristRing{nm}', 0.06, 0.028, P['wr' + nm], 'ano', verts=40); on_bone(o, 'jElbow' + nm)
    on_bone(torus(f'wristBearing{nm}', 0.059, 0.006, P['wr' + nm] + Vector((0, 0, -0.018)), 'chrome'), 'jWrist' + nm)
    on_bone(sphere(f'glove{nm}', 0.05, P['wr' + nm] + Vector((0, 0.005, -0.08)), 'grey', scale=(0.95, 0.6, 1.45)), 'jWrist' + nm)
    on_bone(sphere(f'gloveGrip{nm}', 0.045, P['wr' + nm] + Vector((-0.012 * s, 0.025, -0.085)), 'dark', scale=(0.8, 0.45, 1.25)), 'jWrist' + nm)
    on_bone(sphere(f'thumb{nm}', 0.02, P['wr' + nm] + Vector((-0.045 * s, 0.03, -0.075)), 'grey', scale=(0.9, 0.9, 2.0)), 'jWrist' + nm)
    if nm == 'L':                                       # cuff checklist
        on_bone(box('cuffBook', (0.09, 0.07, 0.012), P['el' + nm].lerp(P['wr' + nm], 0.62) + Vector((0, 0.07, 0)), 'dark', 0.004, 1), 'jElbow' + nm)
# legs: hip bearings, red EV1 stripes, knee bands, boots
for s, nm in ((1, 'R'), (-1, 'L')):
    on_bone(torus(f'hipBearing{nm}', 0.105, 0.014, P['hip' + nm] + Vector((0, 0, -0.02)), 'chrome'), 'jHip' + nm)
    for t in (0.28, 0.6):
        on_bone(torus(f'stripe{nm}{t}', 0.1, 0.012, P['hip' + nm].lerp(P['kn' + nm], t), 'stripe', scale=(1, 1, 1.6)), 'jHip' + nm)
    on_bone(torus(f'stripeK{nm}', 0.088, 0.011, P['kn' + nm].lerp(P['an' + nm], 0.15), 'stripe', scale=(1, 1, 1.6)), 'jKnee' + nm)
    on_bone(torus(f'shinBand{nm}', 0.082, 0.006, P['kn' + nm].lerp(P['an' + nm], 0.55), 'grey'), 'jKnee' + nm)
    on_bone(box(f'boot{nm}', (0.135, 0.31, 0.14), P['an' + nm] + Vector((0, 0.05, -0.07)), 'grey', 0.04, 2), 'jKnee' + nm)
    on_bone(box(f'sole{nm}', (0.135, 0.32, 0.025), P['an' + nm] + Vector((0, 0.05, -0.135)), 'dark', 0.008, 1), 'jKnee' + nm)
    on_bone(torus(f'ankleRing{nm}', 0.074, 0.01, P['an' + nm] + Vector((0, 0, 0.02)), 'chrome'), 'jKnee' + nm)

for o in scene.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True, export_materials='EXPORT', export_animations=False)
print('EXPORTED', OUT, 'faces', sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH'))

if PREVIEW:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'; scene.display.shading.color_type = 'MATERIAL'; scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 900, 1100
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.location = (2.2, 3.0, 1.4)
    cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 60; scene.camera = cam
    activate(arm); bpy.ops.object.mode_set(mode='POSE')
    pb = arm.pose.bones
    for n, r in (('jShoulderL', (0.9, 0, 0.2)), ('jElbowL', (0.9, 0, 0)), ('jHipR', (0.4, 0, 0)), ('jKneeR', (-0.8, 0, 0)), ('jShoulderR', (0.3, 0, -0.15)), ('jElbowR', (0.5, 0, 0))):
        pb[n].rotation_mode = 'XYZ'; pb[n].rotation_euler = r
    bpy.ops.object.mode_set(mode='OBJECT')
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
