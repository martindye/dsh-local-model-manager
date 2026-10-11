import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { DEFAULTS } from '../src/config.mjs'
import { probeServer } from '../src/lifecycle.mjs'

async function fixture(t, handler) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { ...DEFAULTS, targetPort: server.address().port, probeTimeoutMs: 50 }
}

test('top-level context and model ids are supported across llama.cpp probe variants', async t => {
  const config = await fixture(t, (request, response) => {
    response.end(JSON.stringify(request.url === '/v1/models' ? { data: [{ id: 'alias' }] } : { n_ctx: 8192 }))
  })
  assert.deepEqual(await probeServer(config), { running: true, nCtx: 8192, modelIds: ['alias'] })
})

test('truncated and stalled readiness responses settle without hanging the manager', { timeout: 5000 }, async t => {
  const truncated = await fixture(t, (_request, response) => {
    response.writeHead(200, { 'content-length': 100 })
    response.end('{}')
  })
  assert.equal((await probeServer(truncated)).running, false)
  const stalled = await fixture(t, () => {})
  assert.equal((await probeServer(stalled)).running, false)
})

test('missing context props do not make a healthy llama.cpp server look offline', async t => {
  const config = await fixture(t, (request, response) => {
    if (request.url === '/props') { response.writeHead(404); response.end(); return }
    response.end(JSON.stringify({ data: [{ id: 'alias' }] }))
  })
  assert.deepEqual(await probeServer(config), { running: true, nCtx: null, modelIds: ['alias'] })
})
