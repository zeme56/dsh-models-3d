#!/usr/bin/env node
/**
 * add-model.mjs —— 往地标展厅里加一件展品。
 *
 * 做三件事：把 .glb 复制进 assets/models/，把缩略图复制进 assets/thumbs/，
 * 再往 assets/manifest.json 里追加一条记录（三角形数、材质数、节点数直接从 glb 里读）。
 *
 * 用法：
 *   node tools/add-model.mjs --glb D:\models\colosseum.glb --id colosseum \
 *     --zh 罗马斗兽场 --place-zh "罗马 · 意大利" --year 80 --accent "#c9a227" \
 *     --blurb-zh "……" [--en "Colosseum"] [--place-en "Rome · Italy"] [--blurb-en "…"] \
 *     [--scale-zh "高 48 m"] [--thumb D:\models\colosseum.png] [--dry-run]
 *
 * 所有 --xx-zh / --en 字段都可省略：省了就用同一个值，客户端 pick() 会照样显示。
 */

import { copyFile, readFile, writeFile, stat, mkdir } from "node:fs/promises"
import { dirname, basename, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const ASSETS = join(ROOT, "assets")
const MANIFEST = join(ASSETS, "manifest.json")

/* ---------- 参数 ---------- */

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith("--")) continue
    const name = key.slice(2)
    if (name === "dry-run" || name === "help") { out[name] = true; continue }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("--")) throw new Error(`参数 --${name} 缺少取值`)
    out[name] = value
    i++
  }
  return out
}

const USAGE = `用法: node tools/add-model.mjs --glb <file.glb> --id <id> --zh <名称>
  可选: --en --place-zh --place-en --year --scale-zh --scale-en
        --blurb-zh --blurb-en --accent "#rrggbb" --thumb <file.png> --dry-run`

/* ---------- GLB 解析：只读 JSON chunk，数三角面 / 材质 / 节点 ---------- */

async function inspectGlb(file) {
  const buf = await readFile(file)
  if (buf.length < 20) throw new Error(`${basename(file)} 太小，不是有效 glb`)
  const magic = buf.readUInt32LE(0)
  if (magic !== 0x46546c67) throw new Error(`${basename(file)} 不是 glTF 二进制（magic 不符）`)
  const version = buf.readUInt32LE(4)
  if (version !== 2) throw new Error(`${basename(file)} 是 glTF ${version}，只支持 2.0`)

  let offset = 12
  let json = null
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32LE(offset)
    const type = buf.readUInt32LE(offset + 4)
    offset += 8
    if (type === 0x4e4f534a) { // "JSON"
      json = JSON.parse(buf.subarray(offset, offset + len).toString("utf8"))
      break
    }
    offset += len
  }
  if (!json) throw new Error(`${basename(file)} 里没有 JSON chunk`)

  const accessors = json.accessors ?? []
  let triangles = 0
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4 // 4 = TRIANGLES
      const count = prim.indices != null
        ? (accessors[prim.indices]?.count ?? 0)
        : (accessors[prim.attributes?.POSITION]?.count ?? 0)
      if (mode === 4) triangles += Math.floor(count / 3)
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2) // strip / fan
    }
  }

  return {
    triangles,
    materials: (json.materials ?? []).length,
    nodes: (json.nodes ?? []).length,
    meshes: (json.meshes ?? []).length,
  }
}

/* ---------- 主流程 ---------- */

function slugOf(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function pair(zh, en) {
  if (zh == null) return null
  return en == null || en === zh ? zh : { zh, en }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { console.log(USAGE); return }

  if (!args.glb) throw new Error("必须给 --glb <文件.glb>")
  const id = slugOf(args.id ?? basename(args.glb, extname(args.glb)))
  if (!id) throw new Error("--id 无法生成合法标识")
  const zh = args.zh ?? id

  const glbPath = resolve(args.glb)
  const glbStat = await stat(glbPath).catch(() => null)
  if (!glbStat?.isFile()) throw new Error(`找不到 glb 文件：${glbPath}`)

  const info = await inspectGlb(glbPath)
  if (info.triangles <= 0) throw new Error("glb 里没有三角面，检查一下导出设置")

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"))
  if (!Array.isArray(manifest.models)) manifest.models = []
  if (manifest.models.some((m) => m.id === id)) {
    throw new Error(`manifest 里已经有 id="${id}" 了；换个 --id，或先手动删掉旧条目`)
  }

  const modelRel = `models/${id}.glb`
  const entry = {
    id,
    accent: args.accent ?? "#8aa0b8",
    name: { zh, en: args.en ?? zh },
    place: pair(args["place-zh"] ?? "—", args["place-en"]) ?? { zh: "—", en: "—" },
    year: args.year,
    scale: pair(args["scale-zh"], args["scale-en"]),
    blurb: pair(args["blurb-zh"], args["blurb-en"]),
    model: modelRel,
    thumb: null,
    bytes: glbStat.size,
    triangles: info.triangles,
    materials: info.materials,
    nodes: info.nodes,
  }

  // 缺省字段直接不写（客户端 pick() 对 undefined 是安全的，写 null 反而可能渲染成 "null"）
  for (const key of ["year", "scale", "blurb"]) {
    if (entry[key] == null) delete entry[key]
  }

  if (args.thumb) {
    const thumbPath = resolve(args.thumb)
    const thumbStat = await stat(thumbPath).catch(() => null)
    if (!thumbStat?.isFile()) throw new Error(`找不到缩略图：${thumbPath}`)
    entry.thumb = `thumbs/${id}${extname(thumbPath).toLowerCase() || ".png"}`
  }

  if (args["dry-run"]) {
    console.log("（dry-run，不写任何文件）将要追加的条目：")
    console.log(JSON.stringify(entry, null, 2))
    return
  }

  await mkdir(join(ASSETS, "models"), { recursive: true })
  await copyFile(glbPath, join(ASSETS, modelRel))
  if (args.thumb) {
    await mkdir(join(ASSETS, "thumbs"), { recursive: true })
    await copyFile(resolve(args.thumb), join(ASSETS, entry.thumb))
  }

  manifest.models.push(entry)
  const stamp = createHash("sha1").update(`${id}:${glbStat.size}:${Date.now()}`).digest("hex").slice(0, 10)
  manifest.version = stamp
  manifest.generatedAt = new Date().toISOString()
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8")

  console.log(`✓ 已加入「${zh}」`)
  console.log(`  模型   ${modelRel}  (${(entry.bytes / 1024 / 1024).toFixed(2)} MB, ${entry.triangles} 三角面)`)
  if (entry.thumb) console.log(`  缩略图 ${entry.thumb}`)
  console.log(`  manifest.version → ${stamp}（共 ${manifest.models.length} 件展品）`)
  console.log("  刷新页面即可看到；已经打开的页面需要重进一次「地标 3D」。")
}

main().catch((error) => {
  console.error(`✗ ${error.message}`)
  console.error(USAGE)
  process.exitCode = 1
})
