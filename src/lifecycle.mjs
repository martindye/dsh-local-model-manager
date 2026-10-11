import http from 'node:http'
import { spawn } from 'node:child_process'
import { openSync, closeSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { serverLaunch, serverStop, launchPreferences } from './launch.mjs'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function probePath(config, path) {
  return new Promise(resolve => {
    let settled = false
    let deadline
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(deadline); resolve(value) } }
    const request = http.get({
      host: config.targetHost, port: config.targetPort, path,
      timeout: config.probeTimeoutMs,
      headers: config.targetApiKey ? { authorization: `Bearer ${config.targetApiKey}` } : {},
    }, response => {
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > 4 * 1024 * 1024) { request.destroy(); finish({ ok: false, json: null }); return }
        chunks.push(chunk)
      })
      response.on('error', () => finish({ ok: false, json: null }))
      response.on('aborted', () => finish({ ok: false, json: null }))
      response.on('end', () => {
        let json = null
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (error) { /* readiness may be a non-JSON response */ }
        finish({ ok: response.statusCode === 200, json })
      })
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => finish({ ok: false, json: null }))
    deadline = setTimeout(() => { request.destroy(); finish({ ok: false, json: null }) }, config.probeTimeoutMs)
  })
}

/** Read llama.cpp readiness, context and advertised model ids without inference. */
export async function probeServer(config) {
  const models = await probePath(config, '/v1/models')
  if (!models.ok) return { running: false, nCtx: null, modelIds: [] }
  const props = await probePath(config, '/props')
  const rawContext = props.ok ? props.json?.default_generation_settings?.n_ctx ?? props.json?.n_ctx : null
  return {
    running: true,
    nCtx: Number.isSafeInteger(rawContext) && rawContext > 0 ? rawContext : null,
    modelIds: Array.isArray(models.json?.data) ? models.json.data.map(model => model.id).filter(id => typeof id === 'string') : [],
  }
}

/** One backend per plugin instance; injected dependencies keep tests isolated. */
export class ModelLifecycle {
  constructor(config, log = () => {}, dependencies = {}) {
    this.config = config
    this.log = log
    this.spawn = dependencies.spawn ?? spawn
    this.platform = dependencies.platform ?? process.platform
    this.environment = dependencies.environment ?? process.env
    this.probe = dependencies.probe ?? (() => probeServer(this.config))
    this.sleep = dependencies.sleep ?? sleep
    this.now = dependencies.now ?? Date.now
    this.pending = null
    this.child = null
    this.childExitCode = null
    this.activeRequest = null
    this.disposed = false
  }

  matches(probe, request) {
    const context = probe.nCtx == null || (request.contextSize <= probe.nCtx && probe.nCtx < request.contextSize + this.config.contextRounding)
    const model = !request.servedModel || probe.modelIds.includes(request.servedModel)
    return context && model
  }

  start(request) {
    const preferences = launchPreferences(request.config)
    const launch = serverLaunch(request.config, request.contextSize, this.environment, this.platform, request.modelId)
    this.log(`starting server: ${request.config.startCommand || request.config.startScript} -ContextSize ${request.contextSize} (CUDA graphs ${preferences.disableCudaGraphs ? 'disabled' : 'enabled'}, console ${preferences.openConsole ? 'visible' : 'hidden'})`)
    this.childExitCode = null
    let descriptor
    let child
    try {
      if (launch.diagnosticPath) {
        mkdirSync(dirname(launch.diagnosticPath), { recursive: true, mode: 0o700 })
        descriptor = openSync(launch.diagnosticPath, 'a', 0o600)
        launch.options.stdio = ['ignore', descriptor, descriptor]
      }
      child = this.spawn(launch.command, launch.args, launch.options)
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }
    this.child = child
    this.activeRequest = request
    let errorTail = ''
    child.stderr?.on('data', data => { errorTail = (errorTail + String(data)).slice(-4000) })
    child.on('error', error => {
      if (this.child !== child) return
      this.childExitCode = -1
      this.log(`launcher error: ${error.message}`)
    })
    child.on('exit', code => {
      if (this.child !== child) return
      this.childExitCode = code
      this.log(`server launcher exited (code=${code})`)
      if (code !== 0 && errorTail.trim()) this.log(`launcher stderr: ${errorTail.trim()}`)
    })
    child.unref()
  }

  async waitForReady(request, label) {
    const deadline = this.now() + this.config.startTimeoutMs
    let lastLog = 0
    for (;;) {
      if (this.disposed) throw new Error('Model manager disposed while awaiting readiness')
      if (this.now() > deadline) throw new Error(`server did not become ready within ${Math.round(this.config.startTimeoutMs / 1000)}s (${label})`)
      await this.sleep(this.config.pollMs)
      const probe = await this.probe()
      if (probe.running && this.matches(probe, request)) {
        this.log(`server ready (${label}, n_ctx=${probe.nCtx})`)
        return probe
      }
      if (this.childExitCode != null && this.childExitCode !== 0) throw new Error(`server launcher exited with code ${this.childExitCode}; see ${request.config.commandLogPath || this.config.logPath}`)
      if (this.now() - lastLog > 30000) {
        this.log(`still waiting for server (${label})...`)
        lastLog = this.now()
      }
    }
  }

  async stop(request) {
    const stopping = this.activeRequest ?? request
    const launch = serverStop(stopping.config, stopping.contextSize, this.environment, this.platform, stopping.modelId)
    this.log(`stopping server via ${stopping.config.stopCommand || stopping.config.stopScript}`)
    const child = this.spawn(launch.command, launch.args, launch.options)
    let failure = null
    let exitCode = null
    child.on('error', error => { failure = error })
    child.on('exit', code => { exitCode = code })
    child.stderr?.resume()
    const deadline = this.now() + this.config.stopTimeoutMs
    try {
      for (;;) {
        if (this.disposed) throw new Error('Model manager disposed while awaiting stop')
        await this.sleep(Math.min(1000, this.config.pollMs))
        const probe = await this.probe()
        if (!probe.running) return
        if (failure) throw new Error(`Stop command failed: ${failure.message}; no replacement was started`)
        if (exitCode != null && exitCode !== 0) throw new Error(`Stop command exited with code ${exitCode}; no replacement was started`)
        if (this.now() > deadline) throw new Error('Server did not stop before stopTimeoutMs; no replacement was started')
      }
    } finally {
      if (child.exitCode === null && !child.killed) child.kill()
    }
  }

  async ensure(request) {
    // A concurrent request must re-check its own context/model after a launch.
    while (this.pending) await this.pending
    if (this.disposed) throw new Error('Model manager has been disposed')
    const operation = this.ensureOnce(request)
    this.pending = operation
    try { return await operation } finally { if (this.pending === operation) this.pending = null }
  }

  async ensureOnce(request) {
    const probe = await this.probe()
    if (!this.config.manageServer) {
      if (!probe.running) throw new Error('Externally managed llama.cpp server is unavailable; no launch was attempted')
      if (request.servedModel && !probe.modelIds.includes(request.servedModel)) throw new Error('Externally managed server is not serving the requested model; no restart was attempted')
      return probe
    }
    if (!probe.running) {
      this.log(`server not running — starting with -ContextSize ${request.contextSize}`)
      this.start(request)
      return this.waitForReady(request, 'cold start')
    }
    if (!this.matches(probe, request)) {
      this.log(`model/context mismatch: running n_ctx=${probe.nCtx}, requested ${request.contextSize} — restarting to match`)
      await this.stop(request)
      this.start(request)
      return this.waitForReady(request, 'resize/model restart')
    }
    this.log(probe.nCtx == null ? `server running but n_ctx unknown — trusting it (requested ${request.contextSize})`
      : `server already matching (n_ctx=${probe.nCtx}, requested ${request.contextSize})`)
    return probe
  }

  /** Stop accepting work; an already launched backend survives host disposal. */
  dispose() { this.disposed = true }
}
