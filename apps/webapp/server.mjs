import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.join(__dirname, 'dist')
const indexHtmlPath = path.join(distDir, 'index.html')
const backendOrigin = (process.env.BACKEND_PROXY_TARGET || process.env.VITE_API_BASE_URL || 'http://localhost:9812').replace(/\/+$/, '')
const port = Number.parseInt(process.env.PORT || '4173', 10)

const mimeByExt = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const hasSetCookie = headers => typeof headers.getSetCookie === 'function'
const requestHasBody = method => !['GET', 'HEAD'].includes(method.toUpperCase())
const resolveMimeType = filePath => mimeByExt.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream'
const stripApiPrefix = pathname => (pathname === '/api' ? '/' : pathname.replace(/^\/api/, ''))

const sendStaticFile = (res, filePath) => {
  res.statusCode = 200
  res.setHeader('Content-Type', resolveMimeType(filePath))
  createReadStream(filePath).pipe(res)
}

const sendNotFound = res => {
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end('Not Found')
}

const copyProxyHeaders = (sourceHeaders, res) => {
  sourceHeaders.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') {
      res.setHeader(key, value)
    }
  })
  if (hasSetCookie(sourceHeaders)) {
    const cookies = sourceHeaders.getSetCookie()
    if (cookies.length > 0) {
      res.setHeader('set-cookie', cookies)
    }
  }
}

const proxyApi = async (req, res, url) => {
  const upstreamUrl = `${backendOrigin}${stripApiPrefix(url.pathname)}${url.search}`
  const headers = new Headers()
  Object.entries(req.headers).forEach(([key, value]) => {
    if (value === undefined || key.toLowerCase() === 'host' || key.toLowerCase() === 'content-length') {
      return
    }
    if (Array.isArray(value)) {
      value.forEach(item => headers.append(key, item))
      return
    }
    headers.set(key, value)
  })

  try {
    const body = requestHasBody(req.method || 'GET') ? req : undefined
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      ...(body ? { duplex: 'half' } : {}),
      redirect: 'manual',
    })

    res.statusCode = upstream.status
    copyProxyHeaders(upstream.headers, res)

    if (!upstream.body) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body).pipe(res)
  } catch {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ detail: 'Upstream proxy request failed.' }))
  }
}

const tryStaticFile = async urlPath => {
  const relativePath = urlPath === '/' ? '/index.html' : urlPath
  const decoded = decodeURIComponent(relativePath)
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '')
  const candidate = path.join(distDir, normalized)
  if (!candidate.startsWith(distDir)) {
    return null
  }
  try {
    await access(candidate)
    return candidate
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    await proxyApi(req, res, url)
    return
  }

  const staticFile = await tryStaticFile(url.pathname)
  if (staticFile) {
    sendStaticFile(res, staticFile)
    return
  }

  try {
    await access(indexHtmlPath)
    sendStaticFile(res, indexHtmlPath)
  } catch {
    sendNotFound(res)
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`webapp_proxy_server_started port=${port} backend_origin=${backendOrigin}`)
})
