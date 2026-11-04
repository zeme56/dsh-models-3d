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


def shrink_textures(max_size=1024):
    """4K source packs make a 400 MB GLB no browser will load; 1K is plenty
    for the gallery's 4 m viewing distance."""
    changed = 0
    for img in bpy.data.images:
        try:
            width, height = img.size
        except Exception:
            continue
        if not width or not height:
            continue
        longest = max(width, height)
        if longest <= max_size:
            continue
        scale = max_size / float(longest)
        try:
            img.scale(max(1, int(width * scale)), max(1, int(height * scale)))
            changed += 1
        except Exception:
            pass
    return changed



def hide_extra_lods():
    """Asset packs ship LOD0..LODn on top of each other. Keep the lightest
    variant of each family so we do not export the same tree three times."""
    import re
    families = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        match = re.search(r"_LOD(\d+)$", obj.name)
        if not match:
            continue
        base = obj.name[: match.start()]
        families.setdefault(base, []).append((int(match.group(1)), obj))
    kept = []
    for base, items in families.items():
        items.sort(key=lambda item: item[0], reverse=True)
        kept.append(items[0][1].name)
        for _, obj in items[1:]:
            try:
                bpy.data.objects.remove(obj, do_unlink=True)
            except Exception:
                obj.hide_viewport = True
                obj.hide_render = True
    return kept


def mesh_triangles():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_viewport:
            continue
        try:
            mesh = obj.evaluated_get(depsgraph).to_mesh()
            mesh.calc_loop_triangles()
            total += len(mesh.loop_triangles)
            obj.evaluated_get(depsgraph).to_mesh_clear()
        except Exception:
            pass
    return total


def decimate_to_budget(budget):
    total = mesh_triangles()
    if total <= budget:
        return total, 1.0, 0
    ratio = budget / float(total)
    touched = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_viewport:
            continue
        mod = obj.modifiers.new("DSHDecimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        touched += 1
    return total, ratio, touched


def main():
    target = out_path()
    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)

    for obj in bpy.context.scene.objects:
        obj.hide_viewport = False
        obj.hide_render = False

    kept = hide_extra_lods()
    shrunk = shrink_textures(1024)
    budget = 350000
    before, ratio, touched = decimate_to_budget(budget)

    no_tex = "--no-textures" in sys.argv
    kwargs = dict(
        filepath=target,
        export_format="GLB",
        export_apply=True,
        export_cameras=True,
        export_lights=False,
        export_yup=True,
    )
    if no_tex:
        kwargs["export_image_format"] = "NONE"
    bpy.ops.export_scene.gltf(**kwargs)

    report = scene_stats()
    report["file"] = os.path.basename(target)
    report["bytes"] = os.path.getsize(target) if os.path.exists(target) else 0
    report["texturesShrunk"] = shrunk
    report["lodKept"] = kept
    report["trianglesBefore"] = before
    report["decimate"] = round(ratio, 3)
    report["decimatedMeshes"] = touched
    print("MODELS3D_EXPORT " + json.dumps(report, ensure_ascii=False))


main()
