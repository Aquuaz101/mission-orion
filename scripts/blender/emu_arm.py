"""
EMU (spacesuit) right arm for the first-person spacewalk: Phase VI-style glove + lower sleeve.
Run headless:  blender -b -P scripts/blender/emu_arm.py -- out.glb [preview.png]

Built at real scale (metres), in the same frame the game uses for the hand root (wrist pivot at the origin):
Blender +Y = hand forward (three.js -Z), Blender -Z = palm side (three.js -Y).
- Glove: one continuous skinned mesh (skin-modifier skeleton -> subdivision) so knuckles bend like padded fabric.
- Bones: hand, f{0..3}_{0..2} (index..pinky), t_{0..2} (thumb). Bone roll puts local +Z on the palm side, so a
  positive rotation about local X curls toward the palm.
- Rigid details (bellows rings, rubber tip caps, restraint straps) are parented to their bones.
- Sleeve with convolute bearing rings and fabric folds, gauntlet, anodised wrist disconnect with chrome bearing,
  latch pins and bolt heads (rigid, parented to the armature object).
Material names (fabric, fabricDark, grip, tip, chrome, ano, black) are swapped for the game's textured materials.
"""
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'emu_arm.glb'
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATS = {}
for name, col in [('fabric', (0.92, 0.91, 0.88, 1)), ('fabricDark', (0.7, 0.69, 0.66, 1)), ('grip', (0.12, 0.13, 0.15, 1)),
                  ('tip', (0.2, 0.22, 0.25, 1)), ('chrome', (0.85, 0.86, 0.88, 1)), ('ano', (0.7, 0.12, 0.12, 1)), ('black', (0.02, 0.02, 0.02, 1))]:
    m = bpy.data.materials.new(name)
    m.diffuse_color = col
    MATS[name] = m


def link(obj):
    scene.collection.objects.link(obj)
    return obj


def activate(obj):
    for o in scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_mods(obj):
    activate(obj)
    for md in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


def smart_uv(obj, scale=1.0):
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # uniform texel density: UVs in metres * scale (fabric weave tiles in the game)
    me = obj.data
    uv = me.uv_layers.active.data
    area3 = sum(p.area for p in me.polygons)
    area2 = 0.0
    for p in me.polygons:
        pts = [uv[i].uv for i in p.loop_indices]
        a = 0.0
        for k in range(1, len(pts) - 1):
            a += abs((pts[k] - pts[0]).cross(pts[k + 1] - pts[0])) / 2
        area2 += a
    s = math.sqrt(area3 / max(area2, 1e-9)) * scale
    for d in uv:
        d.uv = d.uv * s


# ───────────────────────────── skeleton layout (shared by skin + bones)
FX = [-0.031, -0.0105, 0.0105, 0.03]                      # index … pinky (right hand; thumb on -X)
LENS = [[0.03, 0.022, 0.019], [0.033, 0.024, 0.02], [0.031, 0.023, 0.019], [0.025, 0.019, 0.017]]
KNUCKLE_Y, KZ = 0.104, 0.003
fingers = []                                               # per finger: list of joint points (knuckle … tip)
for fi, x in enumerate(FX):
    splay = -x * 0.9                                       # fingers fan out slightly
    d = Vector((math.sin(splay), math.cos(splay), -0.02)).normalized()
    p = Vector((x, KNUCKLE_Y, KZ))
    pts = [p.copy()]
    for L in LENS[fi]:
        p = p + d * L
        pts.append(p.copy())
    fingers.append(pts)
TD = Vector((-0.5, 0.82, -0.28)).normalized()             # thumb: forward, out and toward the palm
t0 = Vector((-0.03, 0.03, -0.007))
thumb = [t0, t0 + TD * 0.032, t0 + TD * 0.062, t0 + TD * 0.088]

# ───────────────────────────── glove: skin modifier skeleton → subdivision
me = bpy.data.meshes.new('glove')
glove = link(bpy.data.objects.new('Glove', me))
bm = bmesh.new()
verts_r = []


def add(p, rx, rz):
    v = bm.verts.new(p)
    verts_r.append((rx, rz))
    return v


w0 = add((0, -0.004, 0), 0.044, 0.036)
w1 = add((0, 0.03, -0.001), 0.048, 0.026)
p0 = add((0, 0.066, 0.0), 0.05, 0.02)
p1 = add((0, 0.088, 0.002), 0.048, 0.017)
bm.edges.new((w0, w1)); bm.edges.new((w1, p0)); bm.edges.new((p0, p1))
for fi, pts in enumerate(fingers):
    prev = p1
    for si, pt in enumerate(pts):
        r = 0.0112 - max(si - 1, 0) * 0.0008 - (0.0012 if fi == 3 else 0)
        if si == 0:
            r += 0.0006
        v = add(pt, r, r * 0.9)
        bm.edges.new((prev, v))
        prev = v
prev = w1
for i, pt in enumerate(thumb):
    r = [0.017, 0.0135, 0.0125, 0.0116][i]
    v = add(pt, r, r * 0.92)
    bm.edges.new((prev, v))
    prev = v
bm.to_mesh(me)
bm.free()
skin = glove.modifiers.new('skin', 'SKIN')
skin.use_smooth_shade = True
for i, sv in enumerate(me.skin_vertices[0].data):
    sv.radius = verts_r[i]
me.skin_vertices[0].data[0].use_root = True
sub = glove.modifiers.new('sub', 'SUBSURF')
sub.levels = sub.render_levels = 3
apply_mods(glove)
for p in glove.data.polygons:
    p.use_smooth = True

# materials by region: palm + finger undersides = rubber grip, fingertips = rubber caps, knuckle bands = darker fabric
for n in ('fabric', 'fabricDark', 'grip', 'tip'):
    glove.data.materials.append(MATS[n])
tips = [pts[-1] for pts in fingers] + [thumb[-1]]
joints = [pt for pts in fingers for pt in pts[1:-1]] + thumb[1:-1]
mw = glove.matrix_world
for p in glove.data.polygons:
    c, n = p.center, p.normal
    idx = 0
    if any((c - t).length < 0.0125 for t in tips):
        idx = 3
    elif n.z < -0.45 and c.y > 0.035:
        idx = 2
    elif any(abs((c - j).length) < 0.0135 and n.z > -0.2 for j in joints):
        idx = 1
    p.material_index = idx

# ───────────────────────────── armature
arm_data = bpy.data.armatures.new('EMU_R')
arm = link(bpy.data.objects.new('EMU_R', arm_data))
activate(arm)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
hand = eb.new('hand'); hand.head = (0, -0.01, 0); hand.tail = (0, 0.08, 0); hand.align_roll((0, 0, -1))
bones = {}
for fi, pts in enumerate(fingers):
    parent = hand
    for si in range(3):
        b = eb.new(f'f{fi}_{si}')
        b.head, b.tail = pts[si], pts[si + 1]
        b.align_roll((0, 0, -1))
        b.parent = parent
        b.use_connect = si > 0
        bones[b.name] = (Vector(pts[si]), Vector(pts[si + 1]))
        parent = b
parent = hand
for i in range(3):
    b = eb.new(f't_{i}')
    b.head, b.tail = thumb[i], thumb[i + 1]
    b.align_roll(Vector((0.65, 0.1, -0.75)))
    b.parent = parent
    b.use_connect = i > 0
    bones[b.name] = (Vector(thumb[i]), Vector(thumb[i + 1]))
    parent = b
bones['hand'] = (Vector((0, -0.01, 0)), Vector((0, 0.08, 0)))
bpy.ops.object.mode_set(mode='OBJECT')

# skin weights: inverse-distance to bone segments (smooth falloff, best 3), robust for this closed glove
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length

groups = {n: glove.vertex_groups.new(name=n) for n in bones}
for v in glove.data.vertices:
    p = v.co
    ds = sorted(((seg_dist(p, a, b), n) for n, (a, b) in bones.items()))[:3]
    ws = [(1.0 / (d + 0.0025) ** 4, n) for d, n in ds]
    tot = sum(w for w, _ in ws)
    for w, n in ws:
        groups[n].add([v.index], w / tot, 'REPLACE')
glove.parent = arm
mod = glove.modifiers.new('arm', 'ARMATURE')
mod.object = arm


def bone_child(obj, bone_name):
    """Parent a rigid detail to a bone keeping its world placement."""
    mwld = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    bpy.context.view_layer.update()
    obj.matrix_world = mwld


def torus(name, major, minor, center, axis, mat, maj_seg=40, min_seg=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=maj_seg, minor_segments=min_seg, location=center)
    o = bpy.context.active_object
    o.name = name
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
    o.data.materials.append(MATS[mat])
    bpy.ops.object.shade_smooth()
    return o


# ───────────────────────────── sleeve: convolute lower arm (rigid to the wrist), back and down toward the elbow
A = Vector((0, -0.81, -0.58)).normalized()
U = Vector((1, 0, 0))
W = A.cross(U).normalized()
sm = bpy.data.meshes.new('sleeve')
sleeve = link(bpy.data.objects.new('Sleeve', sm))
bm = bmesh.new()
SEG, STEPS = 72, 190
rings = []
for i in range(STEPS + 1):
    s = 0.035 + (0.85 - 0.035) * i / STEPS
    r = 0.05 + (s - 0.035) * 0.055
    for c in (0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76):       # bearing convolutes
        r += 0.0055 * math.exp(-((s - c) / 0.008) ** 2)
        r -= 0.0018 * math.exp(-((s - c - 0.04) / 0.012) ** 2)
    ring = []
    for j in range(SEG):
        a = 2 * math.pi * j / SEG
        # soft fabric folds: low-frequency bulges that drift around the sleeve
        fold = 0.0016 * math.sin(3 * a + s * 23) + 0.0011 * math.sin(5 * a - s * 41 + 1.3) + 0.0008 * math.sin(9 * a + s * 70)
        rr = r + fold * (0.4 + 0.6 * math.sin(math.pi * min(1, (s - 0.035) / 0.1)))
        p = A * s + (U * math.cos(a) + W * math.sin(a)) * rr
        ring.append(bm.verts.new(p))
    rings.append(ring)
for i in range(STEPS):
    for j in range(SEG):
        bm.faces.new((rings[i][j], rings[i][(j + 1) % SEG], rings[i + 1][(j + 1) % SEG], rings[i + 1][j]))
bm.faces.new(list(reversed(rings[-1])))  # closed back end: never an open tube toward the lens
bm.normal_update()
bm.to_mesh(sm)
bm.free()
sm.materials.append(MATS['fabric'])
for p in sm.polygons:
    p.use_smooth = True
activate(sleeve)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
# darker piping on each convolute ridge
for c in (0.12, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76):
    r = 0.05 + (c - 0.035) * 0.055 + 0.0055
    torus(f'pipe{c}', r + 0.0008, 0.0024, A * c, A, 'fabricDark', 64, 10).parent = arm

# ───────────────────────────── wrist disconnect + gauntlet
def cyl(name, r, depth, center, axis, mat, verts=64, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=center)
    o = bpy.context.active_object
    o.name = name
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
    o.data.materials.append(MATS[mat])
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = 3
        apply_mods(o)
    bpy.ops.object.shade_smooth()
    return o

Y = Vector((0, 1, 0))
cyl('ringAno', 0.055, 0.022, (0, -0.03, 0), Y, 'ano', 96, 0.0022).parent = arm
cyl('ringLip', 0.0575, 0.004, (0, -0.042, 0), Y, 'chrome', 96, 0.001).parent = arm
torus('bearing', 0.0535, 0.0058, (0, -0.013, 0), Y, 'chrome', 72, 14).parent = arm
for i in range(3):                                  # latch pins
    a = i / 3 * 2 * math.pi + 0.5
    cyl(f'pin{i}', 0.0042, 0.012, (math.cos(a) * 0.0555, -0.03, math.sin(a) * 0.0555), Vector((math.cos(a), 0, math.sin(a))), 'chrome', 20, 0.0008).parent = arm
for i in range(12):                                 # bolt heads around the ring face
    a = i / 12 * 2 * math.pi
    cyl(f'bolt{i}', 0.0022, 0.003, (math.cos(a) * 0.05, -0.0185, math.sin(a) * 0.05), Y, 'chrome', 6, 0.0004).parent = arm
# gauntlet: flared cuff from the bearing over the back of the hand
gm = bpy.data.meshes.new('gauntlet')
gaunt = link(bpy.data.objects.new('Gauntlet', gm))
bm = bmesh.new()
prof = [(-0.008, 0.047), (0.004, 0.049), (0.02, 0.052), (0.036, 0.0545), (0.048, 0.055), (0.052, 0.0535)]
rings = []
for y, r in prof:
    rings.append([bm.verts.new((math.cos(2 * math.pi * j / 64) * r, y, math.sin(2 * math.pi * j / 64) * r * 0.82)) for j in range(64)])
for i in range(len(rings) - 1):
    for j in range(64):
        bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % 64], rings[i][(j + 1) % 64]))
bm.to_mesh(gm); bm.free()
gm.materials.append(MATS['fabric'])
gaunt.parent = arm
sol = gaunt.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.003
sb = gaunt.modifiers.new('sub', 'SUBSURF'); sb.levels = 2
apply_mods(gaunt)
for p in gm.polygons:
    p.use_smooth = True
torus('gauntPipe', 0.0548, 0.0022, (0, 0.051, 0), Y, 'fabricDark', 64, 10)
bpy.context.active_object.scale = (1, 0.82, 1)
bpy.context.active_object.parent = arm

# UVs (fabric weave needs them)
for o in (glove, sleeve, gaunt):
    smart_uv(o, 8.0)

# ───────────────────────────── export
for o in scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                          export_materials='EXPORT', export_animations=False, export_normals=True, export_texcoords=True)
tris = sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH')
print('EXPORTED', OUT, 'faces', tris)

if PREVIEW:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 1200, 800
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.location = (0.32, 0.22, 0.2)
    cam.rotation_euler = (Vector((0, 0.03, -0.03)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    scene.camera = cam
    # curl the fingers to a grip pose for the preview
    activate(arm)
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        if pb.name.startswith('f'):
            pb.rotation_mode = 'XYZ'; pb.rotation_euler.x = 0.7 if pb.name.endswith('_0') else 0.9
        if pb.name.startswith('t_') and pb.name != 't_0':
            pb.rotation_mode = 'XYZ'; pb.rotation_euler.x = 0.5
    bpy.ops.object.mode_set(mode='OBJECT')
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
