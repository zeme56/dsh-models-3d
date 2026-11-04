/**
 * dsh-models-3d —— 宿主侧。
 *
 * 只做一件事：把插件 assets/ 以同源 HTTP 暴露给浏览器端
 * （GLB、缩略图、three.js 运行时、manifest）。
 *
 * 曾经提供过「导入本机模型」的接口，后来移除了，原因写在 README.md 里。
 */
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'models-3d'
export const inject = ['webServer']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.resolve(HERE, '..', 'assets')
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

async function manifestPayload() {
  const file = path.join(ASSETS, 'manifest.json')
  const stat = await fs.stat(file)
  const base = JSON.parse(await fs.readFile(file, 'utf8'))
  return {
    ...base,
    // 用 mtime 当版本号，换了模型后客户端会重新取 GLB。
    version: String(Math.floor(stat.mtimeMs)),
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
        return sendJson(res, 200, { ok: true, plugin: 'dsh-models-3d', root: ASSETS })
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

      if ((method === 'GET' || method === 'HEAD') && route.startsWith('/assets/')) {
        const rel = safeRel(route.slice('/assets/'.length))
        if (rel === null) return sendJson(res, 400, { error: 'bad path' })
        return serveFile(req, res, ASSETS, rel)
      }

      return sendJson(res, 404, { error: 'unknown route', route })
    },
  }), 'dsh-models-3d: static assets')
}
