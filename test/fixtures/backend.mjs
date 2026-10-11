/** CPU-only fake llama.cpp endpoint; fixture shutdown requires its random token. */
import http from 'node:http'
const args = process.argv.slice(2)
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const port = Number(option(args.includes('--stop') ? '--stop' : '--port'))
const token = option('--token')
if (!Number.isInteger(port) || port < 1024 || [3080, 8080, 8081, 8443].includes(port) || !token) throw new Error('Invalid isolated fixture address')
if (args.includes('--stop')) {
  const response = await fetch(`http://127.0.0.1:${port}/__fixture_shutdown`, { method: 'POST', headers: { 'x-test-key': token } })
  if (!response.ok) process.exitCode = 2
} else {
  const context = Math.ceil(Number(option('--context')) / 256) * 256
  const model = option('--model') || 'default'
  const apiKey = option('--api-key') || ''
  const server = http.createServer(async (request, response) => {
    if (request.url === '/__fixture_shutdown') {
      if (request.headers['x-test-key'] !== token) { response.writeHead(403); response.end(); return }
      response.end('ok')
      setTimeout(() => { server.closeAllConnections(); server.close(() => process.exit(0)) }, 20)
      return
    }
    if (apiKey && request.headers.authorization !== `Bearer ${apiKey}`) { response.writeHead(401); response.end(); return }
    response.setHeader('content-type', 'application/json')
    if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: model }] })); return }
    if (request.url === '/props') { response.end(JSON.stringify({ default_generation_settings: { n_ctx: context } })); return }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const result = { pid: process.pid, context, model, graphDisable: process.env.GGML_CUDA_DISABLE_GRAPHS ?? null,
      voice: process.env.VOICE_CHAT_PRELOAD_ENGINE ?? null, body }
    if (body.stream) {
      response.setHeader('content-type', 'text/event-stream')
      if (body.delay) await new Promise(resolve => setTimeout(resolve, body.delay))
      if (!response.destroyed) response.end(`data: ${JSON.stringify(result)}\n\n`)
    } else response.end(JSON.stringify(result))
  })
  server.listen(port, '127.0.0.1')
}
