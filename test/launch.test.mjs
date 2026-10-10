import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serverLaunch } from '../src/launch.mjs'

test('graph workaround is confined to the launched model environment', () => {
  const parent = { PATH: 'existing-path', VOICE_CHAT_ENGINE: 'qwen3' }
  const launch = serverLaunch({ startScript: "C:/User's files/start.ps1", disableCudaGraphs: true, openConsole: false }, 225000, parent)
  assert.equal(launch.options.env.GGML_CUDA_DISABLE_GRAPHS, '1')
  assert.equal(parent.GGML_CUDA_DISABLE_GRAPHS, undefined)
  assert.equal(launch.options.env.VOICE_CHAT_ENGINE, 'qwen3')
  assert.equal(launch.options.windowsHide, true)
  assert.equal(launch.options.detached, false)
  assert.deepEqual(launch.args, ['-NoProfile', '-File', "C:/User's files/start.ps1", '-ContextSize', '225000'])
})

test('console opens by default with diagnostics sent through the visible launcher', () => {
  const launch = serverLaunch({ startScript: "C:/User's files/start.ps1", disableCudaGraphs: false }, 225000, {})
  assert.equal(launch.options.windowsHide, true)
  assert.equal(launch.options.detached, false)
  assert.match(launch.args[2], /launch-visible\.ps1$/)
  assert.deepEqual(launch.args.slice(3), ['-StartScript', "C:/User's files/start.ps1", '-ContextSize', '225000'])
})

test('explicit console choice is validated', () => {
  assert.throws(() => serverLaunch({ startScript: 'start.ps1', disableCudaGraphs: false, openConsole: 'false' }, 225000, {}), /openConsole must be a boolean/)
  assert.throws(() => serverLaunch({ startScript: 'start.ps1', disableCudaGraphs: false, openConsole: null }, 225000, {}), /openConsole must be a boolean/)
})

test('default preserves the inherited CUDA graph policy', () => {
  const launch = serverLaunch({ startScript: 'start.ps1', disableCudaGraphs: false }, 225000, { GGML_CUDA_DISABLE_GRAPHS: '0' })
  assert.equal(launch.options.env.GGML_CUDA_DISABLE_GRAPHS, '0')
})

test('invalid launch settings fail before starting a process', () => {
  assert.throws(() => serverLaunch({ startScript: 'start.ps1', disableCudaGraphs: true }, '225000; bad', {}))
  assert.throws(() => serverLaunch({ startScript: 'start.ps1', disableCudaGraphs: 'true' }, 225000, {}))
})
