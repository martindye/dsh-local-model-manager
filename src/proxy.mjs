import http from 'node:http'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { once } from 'node:events'
import { DEFAULTS } from './config.mjs'
import { forwardRequest } from './forward.mjs'
import { ModelLifecycle } from './lifecycle.mjs'
import { modelRequest } from './models.mjs'

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) { reject(new Error('request body too large')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
    request.on('aborted', () => reject(new Error('request aborted')))
  })
}

function parseBody(body) {
  try {
    const json = JSON.parse(body.toString('utf8'))
    return { model: typeof json.model === 'string' ? json.model : null, stream: json.stream === true }
  } catch (error) { return { model: null, stream: false } }
}

function sendError(response, earlySse, message) {
  if (response.destroyed) return
  const error = { error: { message, type: 'server_error' } }
  if (earlySse) response.end(`data: ${JSON.stringify(error)}\n\n`)
  else if (!response.headersSent) {
    response.writeHead(504, { 'content-type': 'application/json' })
    response.end(JSON.stringify(error))
  } else response.end()
}

function upstreamBody(body, servedModel) {
  if (!servedModel || !body.length) return body
  try {
    const json = JSON.parse(body.toString('utf8'))
    if (!json || typeof json !== 'object' || Array.isArray(json) || !Object.hasOwn(json, 'model')) return body
    return Buffer.from(JSON.stringify({ ...json, model: servedModel }))
  } catch (error) { return body }
}

/** Create an isolated manager/proxy; its cleanup never stops the backend. */
export function createModelProxy(config = {}, dependencies = {}) {
  const cfg = { ...DEFAULTS, ...config }
  const log = dependencies.log ?? (message => {
    const line = `[local-model-manager] ${new Date().toISOString()} ${message}`
    try { process.stderr.write(`${line}\n`) } catch (error) { /* stderr may have closed */ }
    if (!cfg.logPath) return
    try {
      mkdirSync(dirname(cfg.logPath), { recursive: true })
      appendFileSync(cfg.logPath, `${line}\n`)
    } catch (error) { /* diagnostics must not break serving */ }
  })
  const lifecycle = new ModelLifecycle(cfg, log, dependencies)

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/health') {
      // What the manager is doing right now, for the model dial and probes:
      // 'starting' means a launch is in flight and any request will be held.
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ ok: true, ...lifecycle.health }))
      return
    }
    if (url.pathname !== '/v1' && !url.pathname.startsWith('/v1/')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: '@martin/dsh-local-model-manager only fronts /v1/*', type: 'invalid_request_error' } }))
      return
    }
    const body = await readBody(request, cfg.maxBodyBytes)
    const { model, stream } = parseBody(body)
    const selected = modelRequest(cfg, model)
    log(`${request.method} ${url.pathname} model=${model ?? '-'} requested_context=${selected.contextSize}`)
    let keepAliveTimer = null
    let earlySse = false
    try {
      if (stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        response.write(': waiting for local model server\n\n')
        earlySse = true
        keepAliveTimer = setInterval(() => { if (!response.destroyed) response.write(': keep-alive\n\n') }, cfg.keepAliveMs)
        response.once('close', () => { if (keepAliveTimer) clearInterval(keepAliveTimer) })
      }
      await lifecycle.ensure(selected)
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null }
      if (response.destroyed || request.aborted) return
      await forwardRequest(request, response, upstreamBody(body, selected.servedModel), url, earlySse, {
        host: cfg.targetHost, port: cfg.targetPort,
        ...(cfg.targetApiKey ? { headers: { authorization: `Bearer ${cfg.targetApiKey}` } } : {}),
      }, log)
    } catch (error) {
      log(`request error: ${error.message}`)
      sendError(response, earlySse, `local model server request failed: ${error.message}`)
    } finally {
      if (keepAliveTimer) clearInterval(keepAliveTimer)
    }
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch(error => {
      log(`unhandled handler error: ${error.message}`)
      sendError(response, response.headersSent, error.message)
    })
  })
  server.requestTimeout = 0
  server.keepAliveTimeout = 600000
  return {
    server, lifecycle, log,
    async listen() {
      log(`starting: proxy ${cfg.proxyHost}:${cfg.proxyPort} -> ${cfg.targetHost}:${cfg.targetPort} (default context ${cfg.defaultContextSize})`)
      server.listen(cfg.proxyPort, cfg.proxyHost)
      await once(server, 'listening')
      log(`proxy listening on http://${cfg.proxyHost}:${server.address().port}`)
    },
    async close() {
      lifecycle.dispose()
      server.closeAllConnections()
      if (server.listening) await new Promise(resolve => server.close(resolve))
    },
  }
}
