import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createModelProxy } from '../src/proxy.mjs'
import { removeTestDirectory } from './cleanup.mjs'

const backend = fileURLToPath(new URL('./fixtures/backend.mjs', import.meta.url))

async function fixture(t, overrides = {}) {
  const reserve = http.createServer()
  reserve.listen(0, '127.0.0.1')
  await once(reserve, 'listening')
  const port = reserve.address().port
  await new Promise(resolve => reserve.close(resolve))
  const token = randomUUID()
  const directory = mkdtempSync(join(tmpdir(), "model-proxy's "))
  const logs = []
  const config = {
    proxyPort: 0, targetPort: port, settingsPath: '', logPath: '', commandLogPath: join(directory, 'backend.log'), defaultContextSize: 8192,
    startTimeoutMs: 8000, stopTimeoutMs: 5000, pollMs: 20, probeTimeoutMs: 300, openConsole: false,
    startCommand: process.execPath, startArgs: [backend, '--port', '{port}', '--context', '{contextSize}', '--model', '{servedModel}', '--token', token],
    stopCommand: process.execPath, stopArgs: [backend, '--stop', '{port}', '--token', token],
    servedModel: 'default', modelContexts: { large: 16384 },
    ...overrides,
  }
  if (overrides.legacy) {
    config.startCommand = ''
    config.stopCommand = ''
    config.startScript = join(directory, 'start model.ps1')
    config.stopScript = join(directory, 'stop model.ps1')
    config.commandEnv = { MODEL_TEST_NODE: process.execPath, MODEL_TEST_BACKEND: backend, MODEL_TEST_PORT: String(port), MODEL_TEST_TOKEN: token }
    writeFileSync(config.startScript, 'param([long]$ContextSize)\n& $env:MODEL_TEST_NODE $env:MODEL_TEST_BACKEND --port $env:MODEL_TEST_PORT --context $ContextSize --model default --token $env:MODEL_TEST_TOKEN\nexit $LASTEXITCODE\n')
    writeFileSync(config.stopScript, '& $env:MODEL_TEST_NODE $env:MODEL_TEST_BACKEND --stop $env:MODEL_TEST_PORT --token $env:MODEL_TEST_TOKEN\nexit $LASTEXITCODE\n')
  }
  if (config.targetApiKey) config.startArgs.push('--api-key', config.targetApiKey)
  const proxy = createModelProxy(config, { log: line => logs.push(line), environment: {
    ...process.env, GGML_CUDA_DISABLE_GRAPHS: '1', VOICE_CHAT_PRELOAD_ENGINE: 'pocket',
  } })
  await proxy.listen()
  t.after(async () => {
    await proxy.close()
    try { await fetch(`http://127.0.0.1:${port}/__fixture_shutdown`, { method: 'POST', headers: { 'x-test-key': token }, signal: AbortSignal.timeout(1000) }) } catch (error) { /* fixture may never have started */ }
    const child = proxy.lifecycle.child
    if (child && child.exitCode === null) {
      await Promise.race([once(child, 'exit').catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))])
      if (child.exitCode === null) child.kill()
    }
  })
  t.after(() => removeTestDirectory(directory))
  const url = `http://127.0.0.1:${proxy.server.address().port}/v1/chat/completions`
  const complete = async model => {
    const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer client-key' }, body: JSON.stringify({ model, messages: [] }) })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    return result
  }
  return { proxy, config, port, token, logs, url, complete }
}

test('real CPU child: cold start, matching adoption, resize, graph isolation and forwarding', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  const first = await f.complete('small')
  assert.equal(first.context, 8192)
  assert.equal(first.graphDisable, null)
  assert.equal(first.voice, 'pocket')
  assert.equal(first.body.model, 'default')
  const matching = await f.complete('small')
  assert.equal(matching.pid, first.pid)
  const resized = await f.complete('large')
  assert.equal(resized.context, 16384)
  assert.notEqual(resized.pid, first.pid)
  assert.equal(f.logs.filter(line => line.startsWith('starting server:')).length, 2)
})

test('real CPU child: simultaneous cold requests share one launch', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const results = await Promise.all([f.complete('small'), f.complete('small'), f.complete('small')])
  assert(results.every(result => result.pid === results[0].pid))
  assert.equal(f.logs.filter(line => line.startsWith('starting server:')).length, 1)
})

test('health endpoint reports the lifecycle state the dial relies on', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const healthUrl = `http://127.0.0.1:${f.proxy.server.address().port}/health`
  const early = await (await fetch(healthUrl)).json()
  assert.equal(early.ok, true)
  assert.equal(early.kind, 'idle')
  await f.complete('small')
  const after = await (await fetch(healthUrl)).json()
  assert.equal(after.kind, 'ready')
  assert.equal(typeof after.since, 'number')
  assert.equal(typeof after.detail, 'string')
})

test('real CPU child: equal-context profiles switch weights by served alias', { timeout: 20000 }, async t => {
  const f = await fixture(t, { modelProfiles: { a: { servedModel: 'alias-a' }, b: { modelPath: '/test-only/b.gguf' } } })
  const first = await f.complete('a')
  const second = await f.complete('b')
  assert.equal(first.model, 'alias-a')
  assert.equal(first.body.model, 'alias-a')
  assert.equal(second.model, 'b')
  assert.equal(second.body.model, 'b')
  assert.notEqual(first.pid, second.pid)
})

test('real CPU child: configured API key authenticates probes and upstream requests', { timeout: 15000 }, async t => {
  const f = await fixture(t, { targetApiKey: 'test-only-backend-key' })
  const result = await f.complete('small')
  assert.equal(result.context, 8192)
  assert(!f.logs.some(line => line.includes('test-only-backend-key')))
})

test('real CPU child survives proxy disposal and is adopted by a new manager', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const first = await f.complete('small')
  await f.proxy.close()
  const next = createModelProxy(f.config, { log: () => {} })
  await next.listen()
  t.after(() => next.close())
  const response = await fetch(`http://127.0.0.1:${next.server.address().port}/v1/chat/completions`, { method: 'POST', body: '{}' })
  assert.equal((await response.json()).pid, first.pid)
  assert.equal(next.lifecycle.child, null)
})

test('full proxy cancellation releases the upstream while the fixture is prefilling', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  await f.complete('small')
  const controller = new AbortController()
  const response = await fetch(f.url, { method: 'POST', body: JSON.stringify({ model: 'small', stream: true, delay: 1000 }), signal: controller.signal })
  await new Promise(resolve => setTimeout(resolve, 100))
  controller.abort()
  await response.body.cancel().catch(() => {})
  for (let attempt = 0; attempt < 20 && !f.logs.some(line => line.includes('cancelling upstream')); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  assert(f.logs.some(line => line.includes('cancelling upstream')))
  assert.equal((await f.complete('small')).context, 8192)
})

test('legacy Windows script still receives ContextSize and supports resize', { skip: process.platform !== 'win32', timeout: 25000 }, async t => {
  const f = await fixture(t, { legacy: true })
  assert.equal((await f.complete('small')).context, 8192)
  assert.equal((await f.complete('large')).context, 16384)
})
