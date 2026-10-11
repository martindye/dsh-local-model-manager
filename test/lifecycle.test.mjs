import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { DEFAULTS } from '../src/config.mjs'
import { ModelLifecycle } from '../src/lifecycle.mjs'
import { modelRequest } from '../src/models.mjs'

function fixture(overrides = {}) {
  const config = { ...DEFAULTS, startCommand: 'dummy-start', startArgs: ['{contextSize}', '{servedModel}'],
    stopCommand: 'dummy-stop', stopArgs: [], settingsPath: '', pollMs: 1, startTimeoutMs: 100, stopTimeoutMs: 10,
    servedModel: 'default', openConsole: false, commandLogPath: '', ...overrides }
  let clock = 0
  let current = { running: false, nCtx: null, modelIds: [] }
  const launches = []
  const spawn = (command, args, options) => {
    launches.push({ command, args, options })
    const child = new EventEmitter()
    child.unref = () => {}
    child.exitCode = 0
    child.kill = () => { child.killed = true }
    if (command === 'dummy-start') current = { running: true, nCtx: Number(args[0]), modelIds: [args[1]] }
    if (command === 'dummy-stop') current = { running: false, nCtx: null, modelIds: [] }
    return child
  }
  const manager = new ModelLifecycle(config, () => {}, {
    spawn, probe: async () => current, sleep: async ms => { clock += ms }, now: () => clock, platform: 'linux', environment: {},
  })
  return { config, manager, launches, set: value => { current = value } }
}

test('cold start, rounded context adoption, resize and backend survival on disposal', async () => {
  const f = fixture()
  await f.manager.ensure(modelRequest(f.config, null))
  assert.equal(f.launches.length, 1)
  f.set({ running: true, nCtx: 225024, modelIds: ['default'] })
  await f.manager.ensure(modelRequest(f.config, null))
  assert.equal(f.launches.length, 1)
  await f.manager.ensure(modelRequest({ ...f.config, defaultContextSize: 350000 }, null))
  assert.deepEqual(f.launches.map(item => item.command), ['dummy-start', 'dummy-stop', 'dummy-start'])
  f.manager.dispose()
  assert.equal(f.launches.length, 3)
  await assert.rejects(f.manager.ensure(modelRequest(f.config, null)), /disposed/)
})

test('parallel cold requests launch once and differing contexts are rechecked', async () => {
  const f = fixture()
  await Promise.all([f.manager.ensure(modelRequest(f.config, null)), f.manager.ensure(modelRequest(f.config, null))])
  assert.equal(f.launches.length, 1)
  await Promise.all([
    f.manager.ensure(modelRequest({ ...f.config, defaultContextSize: 350000 }, null)),
    f.manager.ensure(modelRequest(f.config, null)),
  ])
  assert.deepEqual(f.launches.filter(item => item.command === 'dummy-start').map(item => item.args[0]), ['225000', '350000', '225000'])
})

test('same-sized model profiles switch according to advertised served model', async () => {
  const f = fixture({ modelProfiles: { a: { servedModel: 'a' }, b: { servedModel: 'b' } } })
  await f.manager.ensure(modelRequest(f.config, 'a'))
  await f.manager.ensure(modelRequest(f.config, 'b'))
  assert.deepEqual(f.launches.map(item => item.command), ['dummy-start', 'dummy-stop', 'dummy-start'])
  assert.equal(f.launches[2].args[1], 'b')
})

test('unknown context adopts a running matching model instead of churning', async () => {
  const f = fixture()
  f.set({ running: true, nCtx: null, modelIds: ['default'] })
  await f.manager.ensure(modelRequest(f.config, null))
  assert.equal(f.launches.length, 0)
})

test('a failed stop never starts a replacement over the existing backend', async () => {
  const f = fixture()
  f.set({ running: true, nCtx: 8192, modelIds: ['default'] })
  const spawn = f.manager.spawn
  f.manager.spawn = (command, args, options) => {
    const child = spawn(command, args, options)
    f.set({ running: true, nCtx: 8192, modelIds: ['default'] })
    return child
  }
  await assert.rejects(f.manager.ensure(modelRequest(f.config, null)), /did not stop/)
  assert.deepEqual(f.launches.map(item => item.command), ['dummy-stop'])
})

test('external management never invokes a launch or stop command', async () => {
  const f = fixture({ manageServer: false })
  await assert.rejects(f.manager.ensure(modelRequest(f.config, null)), /no launch/)
  f.set({ running: true, nCtx: 8192, modelIds: ['default'] })
  await f.manager.ensure(modelRequest(f.config, null))
  assert.equal(f.launches.length, 0)
})

test('spawn failure is reported promptly and does not wait the whole start timeout', async () => {
  const f = fixture()
  f.manager.spawn = () => {
    const child = new EventEmitter()
    child.unref = () => {}
    queueMicrotask(() => child.emit('error', new Error('ENOENT')))
    return child
  }
  await assert.rejects(f.manager.ensure(modelRequest(f.config, null)), /code -1/)
})
