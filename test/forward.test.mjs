import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { forwardRequest } from '../src/forward.mjs'

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function fixture(t, handler, earlySse = true) {
  const upstream = http.createServer(handler)
  const targetPort = await listen(upstream)
  const logs = []
  const proxy = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (earlySse) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': ready\n\n')
    }
    try {
      await forwardRequest(req, res, Buffer.concat(chunks), new URL(req.url, 'http://localhost'),
        earlySse, { host: '127.0.0.1', port: targetPort }, (line) => logs.push(line))
    } catch (error) { res.destroy(error) }
  })
  const proxyPort = await listen(proxy)
  t.after(async () => {
    for (const server of [proxy, upstream]) {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })
  return { url: `http://127.0.0.1:${proxyPort}/v1/chat/completions`, logs }
}

for (const started of [false, true]) {
  test(`cancellation releases upstream ${started ? 'during output' : 'during prefill'}`, { timeout: 5000 }, async (t) => {
    let enteredResolve, closedResolve
    const entered = new Promise((r) => { enteredResolve = r })
    const closed = new Promise((r) => { closedResolve = r })
    const { url, logs } = await fixture(t, (req, res) => {
      req.resume()
      res.on('close', closedResolve)
      if (started) res.write('data: {"text":"hello"}\n\n')
      enteredResolve()
    })
    const controller = new AbortController()
    const response = await fetch(url, { method: 'POST', body: '{}', signal: controller.signal })
    await entered
    controller.abort()
    await closed
    assert.ok(logs.some((line) => line.includes('cancelling upstream')))
    await response.body.cancel().catch(() => {})
  })
}

test('normal completion forwards the body without cancellation', { timeout: 5000 }, async (t) => {
  const { url, logs } = await fixture(t, (req, res) => {
    req.resume()
    res.end('data: {"text":"done"}\n\n')
  })
  assert.match(await (await fetch(url, { method: 'POST', body: '{}' })).text(), /"done"/)
  assert.equal(logs.length, 0)
})

test('non-streaming status and body are preserved', { timeout: 5000 }, async (t) => {
  const { url } = await fixture(t, (req, res) => {
    req.resume()
    res.writeHead(429, { 'content-type': 'application/json' })
    res.end('{"error":"busy"}')
  }, false)
  const response = await fetch(url, { method: 'POST', body: '{}' })
  assert.equal(response.status, 429)
  assert.deepEqual(await response.json(), { error: 'busy' })
})

test('upstream stream failure terminates the consumer', { timeout: 5000 }, async (t) => {
  const { url } = await fixture(t, (req, res) => {
    req.resume()
    res.write('data: partial\n\n')
    setTimeout(() => res.destroy(), 20)
  })
  const response = await fetch(url, { method: 'POST', body: '{}' })
  await assert.rejects(response.text())
})
