/**
 * dsh-models-3d —— 宿主侧。
 *
 * 把插件 assets/ 以同源 HTTP 暴露给浏览器端（GLB、缩略图、three.js 运行时），
 * 并提供：
 *   - GET  /manifest        静态展品 + 用户导入模型合并后的清单
 *   - POST /import?name=…   浏览器上传 GLB（原始字节）
 *   - POST /import-blend    本机 .blend 路径 → 调 Blender 转 GLB 入库
 *   - GET  /blender         本机 Blender 探测结果
 *   - DELETE /import?id=…   删除导入的模型
 */
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'models-3d'
export const inject = ['webServer']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.resolve(HERE, '..', 'assets')
const IMPORTED = path.join(ASSETS, 'imported')
const INDEX_FILE = path.join(IMPORTED, 'index.json')
const BLENDER_SCRIPT = path.join(HERE, 'blender_export.py')
const PREFIX = '/api/models'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.byteLength,
    'cache-control': 'no-store',
  })
  res.end(data)
}

function safeRel(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rel = decoded.replace(/^\/+/, '')
  if (rel === '' || rel.split('/').some((part) => part === '..' || part === '')) return null
  return rel
}

async function serveFile(req, res, rootDir, rel) {
  const file = path.resolve(rootDir, rel)
  const root = rootDir.toLowerCase() + path.sep
  if (!file.toLowerCase().startsWith(root)) {
    return sendJson(res, 403, { error: 'forbidden' })
  }

  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    return sendJson(res, 404, { error: 'not found', path: rel })
  }
  if (!stat.isFile()) return sendJson(res, 404, { error: 'not found', path: rel })

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  const ext = path.extname(file).toLowerCase()
  const headers = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300',
    etag,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  }

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    return res.end()
  }

  const range = req.headers.range
  if (typeof range === 'string' && /^bytes=\d*-\d*$/.test(range)) {
    const [startRaw, endRaw] = range.slice(6).split('-')
    let start = startRaw === '' ? null : Number(startRaw)
    let end = endRaw === '' ? null : Number(endRaw)
    if (start === null && end !== null) {
      start = Math.max(0, stat.size - end)
      end = stat.size - 1
    }
    start = start ?? 0
    end = end === null ? stat.size - 1 : Math.min(end, stat.size - 1)
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` })
      return res.end()
    }
    headers['content-range'] = `bytes ${start}-${end}/${stat.size}`
    headers['content-length'] = String(end - start + 1)
    headers['cache-control'] = 'public, max-age=3600'
    res.writeHead(206, headers)
    createReadStream(file, { start, end }).pipe(res)
    return
  }

  headers['content-length'] = String(stat.size)
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

/* ------------------------------------------------------------------ *
 * 导入：文件存储 + 清单
 * ------------------------------------------------------------------ */

async function ensureDirs() {
  await fs.mkdir(IMPORTED, { recursive: true })
}

async function readIndex() {
  try {
    const data = JSON.parse(await fs.readFile(INDEX_FILE, 'utf8'))
    return Array.isArray(data.models) ? data.models : []
  } catch {
    return []
  }
}

async function writeIndex(models) {
  await ensureDirs()
  await fs.writeFile(INDEX_FILE, JSON.stringify({ version: 1, models }, null, 2), 'utf8')
}

function slugify(name) {
  return (
    String(name)
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'model'
  )
}

function readBody(req, limit = 256 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function glbStats(buffer) {
  try {
    if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) return null
    const jsonLength = buffer.readUInt32LE(12)
    const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
    let triangles = 0
    for (const mesh of json.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        if (primitive.indices !== undefined) {
          const accessor = json.accessors?.[primitive.indices]
          if (accessor) triangles += Math.floor(accessor.count / 3)
        }
      }
    }
    return {
      triangles,
      materials: (json.materials ?? []).length,
      nodes: (json.nodes ?? []).length,
    }
  } catch {
    return null
  }
}

async function addModelFromBuffer(buffer, originalName, extra = {}) {
  const base = `local-${slugify(originalName || 'model')}`
  let id = base
  for (let n = 2; ; n += 1) {
    const taken = await fs.access(path.join(IMPORTED, id + '.glb')).then(() => true, () => false)
    if (!taken) break
    id = `${base}-${n}`
  }
  const file = id + '.glb'
  await ensureDirs()
  await fs.writeFile(path.join(IMPORTED, file), buffer)
  const stats = glbStats(buffer)
  const models = await readIndex()
  const entry = {
    id,
    name: extra.name || originalName || id,
    nameEn: extra.nameEn || '',
    place: extra.place || '',
    year: extra.year || '',
    scale: extra.scale || '',
    blurb: extra.blurb || { zh: '', en: '' },
    accent: extra.accent || '#7fb7ad',
    source: extra.source || 'upload',
    bytes: buffer.length,
    triangles: stats?.triangles ?? null,
    materials: stats?.materials ?? null,
    nodes: stats?.nodes ?? null,
    importedAt: new Date().toISOString(),
  }
  models.unshift(entry)
  await writeIndex(models)
  return { entry, file, stats }
}

/* ------------------------------------------------------------------ *
 * Blender 探测与 .blend 转换
 * ------------------------------------------------------------------ */

async function exists(file) {
  return fs.access(file).then(() => true, () => false)
}

async function findBlender() {
  const explicit = process.env.DSH_BLENDER || process.env.BLENDER_PATH
  if (explicit && (await exists(explicit))) return explicit

  const candidates = []
  const roots = [
    'C:/Program Files/Blender Foundation',
    'C:/Program Files (x86)/Blender Foundation',
    path.join(os.homedir(), 'scoop/apps/blender/current'),
    '/Applications/Blender.app/Contents/MacOS',
    '/usr/bin',
    '/usr/local/bin',
  ]
  for (const root of roots) {
    try {
      for (const entry of await fs.readdir(root)) {
        candidates.push(path.join(root, entry, 'blender.exe'))
        candidates.push(path.join(root, entry, 'blender'))
        candidates.push(path.join(root, entry, 'Contents/MacOS/Blender'))
      }
    } catch {
      /* 目录不存在就跳过 */
    }
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  try {
    const which = process.platform === 'win32' ? 'where.exe' : 'which'
    const out = await new Promise((resolve) => {
      const child = spawn(which, ['blender'], { windowsHide: true })
      let text = ''
      child.stdout.on('data', (chunk) => (text += chunk))
      child.on('close', () => resolve(text))
      child.on('error', () => resolve(''))
    })
    const first = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (first && (await exists(first))) return first
  } catch {
    /* ignore */
  }
  return null
}

function runBlender(blender, blendFile, outFile) {
  return new Promise((resolve) => {
    const child = spawn(blender, ['--background', blendFile, '--python', BLENDER_SCRIPT, '--', outFile], {
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ ok: false, code: -1, stdout, stderr: stderr + '\n[timeout after 10min]' })
    }, 10 * 60 * 1000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > 200000) stdout = stdout.slice(-200000)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > 200000) stderr = stderr.slice(-200000)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, code: -1, stdout, stderr: stderr + '\n' + error.message })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout, stderr })
    })
  })
}

function parseReport(stdout) {
  const match = stdout.match(/MODELS3D_EXPORT\s+(\{.*\})/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

async function manifestPayload() {
  let base = { version: '1', models: [] }
  try {
    base = JSON.parse(await fs.readFile(path.join(ASSETS, 'manifest.json'), 'utf8'))
  } catch {
    /* 静态清单缺失时仍然可以返回导入的模型 */
  }
  const imported = await readIndex()
  const models = [
    ...(base.models ?? []),
    ...imported.map((entry) => ({
      ...entry,
      model: `imported/${entry.id}.glb`,
      thumb: null,
      imported: true,
      place: entry.place || { zh: '本机导入', en: 'Imported' },
      blurb:
        entry.blurb && (entry.blurb.zh || entry.blurb.en)
          ? entry.blurb
          : {
              zh: '从本机导入的模型，可用鼠标环绕观察。',
              en: 'A model imported from this machine. Orbit it with the mouse.',
            },
    })),
  ]
  return {
    ...base,
    version: String(base.version ?? '1') + '-' + imported.length,
    models,
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const route = url.pathname.slice(PREFIX.length) || '/'
      const method = req.method ?? 'GET'

      if (method === 'GET' && route === '/health') {
        return sendJson(res, 200, {
          ok: true,
          plugin: 'dsh-models-3d',
          root: ASSETS,
          imported: (await readIndex()).length,
        })
      }

      if (method === 'GET' && route === '/manifest') {
        try {
          return sendJson(res, 200, await manifestPayload())
        } catch (error) {
          return sendJson(res, 500, {
            error: 'manifest unavailable',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (method === 'GET' && route === '/blender') {
        const blender = await findBlender()
        return sendJson(res, 200, {
          found: Boolean(blender),
          path: blender,
          hint: blender ? null : '没有找到 Blender，可在环境变量 DSH_BLENDER 里填 blender.exe 的完整路径。',
        })
      }

      if (method === 'POST' && route === '/import') {
        try {
          const buffer = await readBody(req)
          if (buffer.length < 12) return sendJson(res, 400, { error: 'empty upload' })
          if (buffer.subarray(0, 4).toString('utf8') !== 'glTF') {
            return sendJson(res, 400, { error: 'not a GLB file' })
          }
          const name = url.searchParams.get('name') || 'model.glb'
          const { entry, stats } = await addModelFromBuffer(buffer, name)
          return sendJson(res, 200, { ok: true, model: entry, stats })
        } catch (error) {
          return sendJson(res, error.status ?? 500, {
            error: 'import failed',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (method === 'POST' && route === '/import-blend') {
        try {
          const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}')
          const blendPath = String(body.path ?? '').trim()
          if (!blendPath) return sendJson(res, 400, { error: 'missing path' })
          const resolved = path.resolve(blendPath)
          if (!(await exists(resolved))) return sendJson(res, 404, { error: 'file not found', path: resolved })
          if (path.extname(resolved).toLowerCase() !== '.blend') {
            return sendJson(res, 400, { error: 'only .blend files can be converted' })
          }
          const blender = await findBlender()
          if (!blender) return sendJson(res, 412, { error: 'blender not found' })
          await ensureDirs()
          const tmp = path.join(IMPORTED, `.tmp-${Date.now()}.glb`)
          const result = await runBlender(blender, resolved, tmp)
          if (!result.ok || !(await exists(tmp))) {
            await fs.rm(tmp, { force: true })
            return sendJson(res, 500, {
              error: 'blender export failed',
              code: result.code,
              tail: (result.stderr || result.stdout).slice(-4000),
            })
          }
          const buffer = await fs.readFile(tmp)
          await fs.rm(tmp, { force: true })
          const baseName = path.basename(resolved, path.extname(resolved))
          const report = parseReport(result.stdout)
          const { entry, stats } = await addModelFromBuffer(buffer, baseName + '.glb', {
            name: baseName,
            source: 'blend',
            blurb: {
              zh: `由 Blender 工程 ${path.basename(resolved)} 转换而来。`,
              en: `Converted from the Blender file ${path.basename(resolved)}.`,
            },
          })
          return sendJson(res, 200, { ok: true, model: entry, stats, report })
        } catch (error) {
          return sendJson(res, 500, {
            error: 'blend import failed',
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (method === 'DELETE' && route === '/import') {
        const id = url.searchParams.get('id')
        if (!id) return sendJson(res, 400, { error: 'missing id' })
        const models = await readIndex()
        const entry = models.find((item) => item.id === id)
        if (!entry) return sendJson(res, 404, { error: 'unknown model' })
        await fs.rm(path.join(IMPORTED, entry.id + '.glb'), { force: true })
        await writeIndex(models.filter((item) => item.id !== id))
        return sendJson(res, 200, { ok: true })
      }

      if ((method === 'GET' || method === 'HEAD') && route.startsWith('/assets/')) {
        const rel = safeRel(route.slice('/assets/'.length))
        if (rel === null) return sendJson(res, 400, { error: 'bad path' })
        return serveFile(req, res, ASSETS, rel)
      }

      return sendJson(res, 404, { error: 'unknown route', route })
    },
  }), 'dsh-models-3d: static assets + import')
}
