/**
 * @martin/dsh-local-model-manager — a DSH profile plugin.
 *
 * On-demand lifecycle for the local llama.cpp Qwen server, driven by the
 * model dropdown, with zero changes to DSH itself:
 *
 *  - runs a small OpenAI-compatible proxy at 127.0.0.1:<proxyPort>
 *    (default 8081) inside the DSH host process; it dies with the harness;
 *  - DSH is pointed at it with one line in settings.yaml:
 *      baseURL: http://127.0.0.1:8081/v1
 *  - on every /v1/* request the proxy reads the dropdown's model id from the
 *    request body, looks up that entry's contextWindow in settings.yaml, and:
 *      - server not running      -> start it with that context size
 *      - running, wrong size     -> stop + restart to match. "Match" allows
 *                                   llama's n_ctx round-up:
 *                                   requested <= n_ctx < requested + 4096
 *      - running, matching size  -> forward
 *  - while the server is (re)starting the request is held open (SSE
 *    keep-alive comments for streaming chat completions) so the client never
 *    times out;
 *  - nothing ever stops the server on its own; a server this plugin started
 *    outlives a harness restart and is adopted on the next probe.
 *
 * Pure Node built-ins; no dependencies. Machine-specific values come from
 * the plugin config (the bundle's cordis.patch.yml).
 */

import http from 'node:http'
import { forwardRequest } from './forward.mjs'
import { serverLaunch } from './launch.mjs'
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'local-model-manager'

const USER_DIR = homedir().replaceAll('\\', '/')
const DEFAULTS = {
  proxyHost: '127.0.0.1',
  proxyPort: 8081,
  targetHost: '127.0.0.1',
  targetPort: 8080,
  settingsPath: `${USER_DIR}/.dsh/profiles/web/cordis.patch.yml`,
  startScript: `${USER_DIR}/OneDrive/Projects/TurboQuantLlamaCppSetup/scripts/start-qwen3.8-27b-q6_0-turboquant-vision.ps1`,
  stopScript: `${USER_DIR}/OneDrive/Projects/TurboQuantLlamaCppSetup/scripts/stop-server.ps1`,
  logPath: `${USER_DIR}/.dsh/logs/local-model.log`,
  defaultContextSize: 225000,
  startTimeoutMs: 420000,
  pollMs: 2000,
  keepAliveMs: 15000,
  maxBodyBytes: 50 * 1024 * 1024,
  disableCudaGraphs: false,
  openConsole: true,
}

let cfg = {}
let logEnabled = false
const state = { running: false, nCtx: null, ours: false, childPid: null, childExitCode: null, inFlight: null }

function log(message) {
  const line = `[local-model-manager] ${new Date().toISOString()} ${message}`
  try { process.stderr.write(`${line}\n`) } catch { /* ignore */ }
  if (!logEnabled) return
  try {
    mkdirSync(dirname(cfg.logPath), { recursive: true })
    appendFileSync(cfg.logPath, `${line}\n`)
  } catch { /* logging must never break the proxy */ }
}

function sleep(ms) { return new Promise((resolve) => { setTimeout(resolve, ms) }) }

/* ------------------------------------------------------------------ */
/* Server probes                                                       */
/* ------------------------------------------------------------------ */

function probePath(path) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
    let req
    try {
      req = http.get(
        { host: cfg.targetHost, port: cfg.targetPort, path, timeout: 4000 },
        (res) => {
          const chunks = []
          res.on('data', (c) => { chunks.push(c) })
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            let json = null
            try { json = JSON.parse(text) } catch { /* non-JSON */ }
            finish({ ok: res.statusCode === 200, json })
          })
        },
      )
      req.on('timeout', () => req.destroy())
      req.on('error', () => finish({ ok: false, json: null }))
    } catch {
      finish({ ok: false, json: null })
    }
  })
}

/** Is the llama server up, and with which context? */
async function probe() {
  const models = await probePath('/v1/models')
  if (!models.ok) return { running: false, nCtx: null }
  const props = await probePath('/props')
  // llama-server nests n_ctx under default_generation_settings (keep a
  // top-level fallback for other builds).
  const rawNCtx = props.ok
    ? (props.json?.default_generation_settings?.n_ctx ?? props.json?.n_ctx ?? null)
    : null
  const nCtx = Number.isFinite(rawNCtx) ? rawNCtx : null
  return { running: true, nCtx }
}

function ctxMatches(nCtx, requested) {
  // llama rounds n_ctx UP to an internal granularity; allow that slack.
  return nCtx != null && requested <= nCtx && nCtx < requested + 4096
}

/* ------------------------------------------------------------------ */
/* Server start / stop                                                 */
/* ------------------------------------------------------------------ */

function startServer(contextSize) {
  log(`starting server: ${cfg.startScript} -ContextSize ${contextSize} (CUDA graphs ${cfg.disableCudaGraphs ? 'disabled' : 'default'}, console ${cfg.openConsole ? 'visible' : 'hidden'})`)
  const launch = serverLaunch(cfg, contextSize, process.env)
  const child = spawn(launch.command, launch.args, launch.options)
  let errorTail = ''
  child.stderr?.on('data', (data) => { errorTail = (errorTail + String(data)).slice(-4000) })
  child.on('error', (err) => {
    state.childExitCode = -1
    log(`launcher error: ${err.message}`)
  })
  child.on('exit', (code) => {
    state.childExitCode = code
    log(`server launcher exited (code=${code})`)
    if (code !== 0 && errorTail.trim()) log(`launcher stderr: ${errorTail.trim()}`)
  })
  child.unref()
  state.ours = true
  state.childPid = child.pid
  state.childExitCode = null
}

/** Stop whatever is listening on the target port (ours or hand-started). */
function stopServer() {
  return new Promise((resolve) => {
    log(`stopping server via ${cfg.stopScript}`)
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-File', cfg.stopScript],
        { windowsHide: true, stdio: 'ignore' })
      child.on('error', (err) => log(`stop child error: ${err.message}`))
    } catch (err) {
      log(`stop spawn failed: ${err.message}`)
      return resolve()
    }
    const started = Date.now()
    const timer = setInterval(async () => {
      const p = await probe()
      if (!p.running || Date.now() - started > 20000) {
        clearInterval(timer)
        if (child.exitCode === null) child.kill()
        state.running = false
        state.nCtx = null
        state.ours = false
        state.childExitCode = null
        resolve()
      }
    }, 1000)
  })
}

async function waitForReady(label) {
  const deadline = Date.now() + cfg.startTimeoutMs
  let lastLog = 0
  for (;;) {
    if (Date.now() > deadline) throw new Error(`server did not become ready within ${Math.round(cfg.startTimeoutMs / 1000)}s (${label})`)
    await sleep(cfg.pollMs)
    const p = await probe()
    if (p.running) {
      state.running = true
      state.nCtx = p.nCtx
      log(`server ready (${label}, n_ctx=${p.nCtx})`)
      return p
    }
    if (state.childExitCode != null && state.childExitCode !== 0) {
      throw new Error(`server launcher exited with code ${state.childExitCode}; see ${cfg.logPath}`)
    }
    if (Date.now() - lastLog > 30000) {
      log(`still waiting for server (${label})...`)
      lastLog = Date.now()
    }
  }
}

/** Single-flight: at most one start/restart in progress at a time. */
async function ensure(requested) {
  if (state.inFlight) return state.inFlight
  state.inFlight = (async () => {
    try {
      const p = await probe()
      if (!p.running) {
        log(`server not running — starting with -ContextSize ${requested}`)
        startServer(requested)
        return await waitForReady('cold start')
      }
      if (p.nCtx == null) {
        // n_ctx unknown (unexpected /props shape): trust a running server
        // rather than churn it.
        log(`server running but n_ctx unknown — trusting it (requested ${requested})`)
        state.running = true
        return p
      }
      if (!ctxMatches(p.nCtx, requested)) {
        log(`context mismatch: running n_ctx=${p.nCtx}, requested ${requested} — restarting to match`)
        await stopServer()
        startServer(requested)
        return await waitForReady('resize restart')
      }
      log(`server already matching (n_ctx=${p.nCtx}, requested ${requested})`)
      state.running = true
      state.nCtx = p.nCtx
      return p
    } finally {
      state.inFlight = null
    }
  })()
  return state.inFlight
}

/* ------------------------------------------------------------------ */
/* settings.yaml: dropdown model id -> contextWindow                   */
/* ------------------------------------------------------------------ */

function contextSizeForModel(modelId) {
  if (!modelId || !cfg.settingsPath) return null
  let text
  try { text = readFileSync(cfg.settingsPath, 'utf8') } catch { return null }
  const lines = text.split(/\r?\n/)
  let current = null
  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s*id:\s*(\S+)/)
    if (idMatch) { current = idMatch[1]; continue }
    if (current === modelId) {
      const cw = line.match(/^\s*contextWindow:\s*(\d+)/)
      if (cw) return Number(cw[1])
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Proxy plumbing                                                      */
/* ------------------------------------------------------------------ */

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        const err = new Error('request body too large')
        err.statusCode = 413
        reject(err)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseOpenAiBody(body) {
  if (!body || body.length === 0) return { model: null, stream: false }
  try {
    const json = JSON.parse(body.toString('utf8'))
    return {
      model: typeof json.model === 'string' ? json.model : null,
      stream: json.stream === true,
    }
  } catch {
    return { model: null, stream: false }
  }
}

function forward(req, res, body, url, earlySse) {
  return forwardRequest(req, res, body, url, earlySse,
    { host: cfg.targetHost, port: cfg.targetPort }, log)
}

function sseError(res, earlySse, message) {
  try {
    if (earlySse) {
      res.write(`data: ${JSON.stringify({ error: { message, type: 'server_error' } })}\n\n`)
      res.end()
    } else if (!res.headersSent) {
      res.writeHead(504, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message, type: 'server_error' } }))
    } else {
      res.end()
    }
  } catch { /* socket already gone */ }
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (!url.pathname.startsWith('/v1')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: '@martin/dsh-local-model-manager only fronts /v1/*', type: 'invalid_request_error' } }))
    return
  }

  let body
  try {
    body = await readBody(req, cfg.maxBodyBytes)
  } catch (err) {
    sseError(res, false, err.message)
    return
  }

  const { model, stream } = parseOpenAiBody(body)
  const requested = model && contextSizeForModel(model)
    ? contextSizeForModel(model)
    : cfg.defaultContextSize
  log(`${req.method} ${url.pathname} model=${model ?? '-'} requested_context=${requested}`)

  let keepAliveTimer = null
  let earlySse = false
  try {
    if (stream) {
      // Open the SSE response immediately so the client's header timeout
      // never fires while the model loads.
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(': waiting for local model server\n\n')
      earlySse = true
      res.once('close', () => {
        if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null }
      })
      keepAliveTimer = setInterval(() => {
        try { res.write(': keep-alive\n\n') } catch { /* socket gone */ }
      }, cfg.keepAliveMs)
    }

    let state2
    try {
      state2 = await ensure(requested)
    } catch (err) {
      log(`ensure failed: ${err.message}`)
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null }
      sseError(res, earlySse, `local model server failed to start: ${err.message}`)
      return
    }
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null }

    if (res.destroyed || req.aborted) return
    await forward(req, res, body, url, earlySse)
  } catch (err) {
    log(`request error: ${err.stack ?? err.message}`)
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null }
    sseError(res, earlySse, String(err.message))
  }
}

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

export function apply(_ctx, config = {}) {
  try {
    cfg = { ...DEFAULTS, ...config }
    logEnabled = Boolean(cfg.logPath)
    log(`starting: proxy ${cfg.proxyHost}:${cfg.proxyPort} -> ${cfg.targetHost}:${cfg.targetPort} (default context ${cfg.defaultContextSize})`)

    const server = http.createServer((req, res) => {
      handle(req, res).catch((err) => {
        log(`unhandled handler error: ${err.stack ?? err.message}`)
        sseError(res, false, String(err.message))
      })
    })
    server.requestTimeout = 0 // hold requests open while the model loads
    server.keepAliveTimeout = 600000
    server.on('error', (err) => log(`FATAL proxy server error: ${err.message}`))
    server.listen(cfg.proxyPort, cfg.proxyHost, () => {
      log(`proxy listening on http://${cfg.proxyHost}:${cfg.proxyPort}`)
    })
  } catch (err) {
    log(`FATAL apply: ${err?.stack ?? err}`)
  }
}
