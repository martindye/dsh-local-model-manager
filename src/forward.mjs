import http from 'node:http'

const HOP_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/** Forward a request, releasing the model slot when its consumer disconnects. */
export function forwardRequest(req, res, body, url, earlySse, target, log) {
  if (res.destroyed || req.aborted) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let settled = false
    let upstreamRes
    const finish = (error) => {
      if (settled) return
      settled = true
      res.off('close', cancel)
      req.off('aborted', cancel)
      if (error) reject(error)
      else resolve()
    }
    const cancel = () => {
      if (res.writableFinished || settled) return
      log('client disconnected; cancelling upstream request')
      upstreamRes?.destroy()
      upstream.destroy()
      finish()
    }
    const headers = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_HEADERS.has(key.toLowerCase())) continue
      headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
    }
    Object.assign(headers, target.headers ?? {})
    headers.host = `${target.host.includes(':') ? `[${target.host}]` : target.host}:${target.port}`
    if (body.length > 0) headers['content-length'] = String(body.length)
    const upstream = http.request(
      { host: target.host, port: target.port, path: url.pathname + url.search, method: req.method, headers },
      (response) => {
        upstreamRes = response
        if (settled) { response.destroy(); return }
        response.on('error', (error) => {
          if (settled) return
          log(`upstream read error: ${error.message}`)
          res.destroy(error)
          finish(error)
        })
        response.on('end', () => finish())
        if (earlySse && response.statusCode >= 400) {
          let errText = ''
          response.on('data', (chunk) => { errText += chunk })
          response.on('end', () => {
            res.write(`: upstream error ${response.statusCode}\n\n`)
            res.end(`data: ${errText || JSON.stringify({ error: { message: `upstream ${response.statusCode}` } })}\n\n`)
          })
          return
        }
        if (!earlySse) {
          const outHeaders = Object.fromEntries(Object.entries(response.headers)
            .filter(([key]) => !HOP_HEADERS.has(key.toLowerCase())))
          res.writeHead(response.statusCode, outHeaders)
        }
        response.pipe(res)
      },
    )
    res.on('close', cancel)
    req.on('aborted', cancel)
    upstream.on('error', (error) => {
      if (settled) return
      log(`upstream connect error: ${error.message}`)
      finish(error)
    })
    if (body.length > 0) upstream.write(body)
    upstream.end()
  })
}
