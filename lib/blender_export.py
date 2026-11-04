"""Blender → GLB exporter used by dsh-models-3d.

Run as:
    blender --background <file.blend> --python blender_export.py -- <out.glb>

Prints one machine-readable line:
    MODELS3D_EXPORT {"objects": 12, "triangles": 3456, "size": [x, y, z], "file": "..."}
"""

import json
import os
import sys

import bpy


def out_path():
    argv = sys.argv
    if "--" in argv:
        rest = argv[argv.index("--") + 1 :]
    else:
        rest = []
    for item in rest:
        if item.lower().endswith(".glb"):
            return item
    raise SystemExit("no .glb output path in argv: " + repr(argv))


def scene_stats():
    objects = 0
    triangles = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            objects += 1
            try:
                evaluated = obj.evaluated_get(depsgraph)
                mesh = evaluated.to_mesh()
                mesh.calc_loop_triangles()
                triangles += len(mesh.loop_triangles)
                evaluated.to_mesh_clear()
            except Exception:
                pass

    import mathutils

    low = mathutils.Vector((1e18, 1e18, 1e18))
    high = mathutils.Vector((-1e18, -1e18, -1e18))
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            low.x = min(low.x, world.x)
            low.y = min(low.y, world.y)
            low.z = min(low.z, world.z)
            high.x = max(high.x, world.x)
            high.y = max(high.y, world.y)
            high.z = max(high.z, world.z)
    if low.x > high.x:
        size = [0.0, 0.0, 0.0]
    else:
        size = [round(high.x - low.x, 2), round(high.y - low.y, 2), round(high.z - low.z, 2)]
    return {"objects": objects, "triangles": triangles, "size": size}


def main():
    target = out_path()
    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)

    for obj in bpy.context.scene.objects:
        obj.hide_viewport = False
        obj.hide_render = False

    bpy.ops.export_scene.gltf(
        filepath=target,
        export_format="GLB",
        export_apply=True,
        export_cameras=True,
        export_lights=False,
        export_yup=True,
    )

    report = scene_stats()
    report["file"] = os.path.basename(target)
    report["bytes"] = os.path.getsize(target) if os.path.exists(target) else 0
    print("MODELS3D_EXPORT " + json.dumps(report, ensure_ascii=False))


main()
