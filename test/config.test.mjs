import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Config } from '../src/config.mjs'
import { serverLaunch } from '../src/launch.mjs'

test('DSH schema defaults enable graphs and console with live launch preferences', () => {
  const config = Config({})
  assert.equal(config.disableCudaGraphs.get(), false)
  assert.equal(config.openConsole.get(), true)
  assert.equal(Config.dict.disableCudaGraphs.meta.volatile, true)
  assert.equal(Config.dict.openConsole.meta.volatile, true)
  assert.equal(Config.dict.proxyPort.meta.volatile, undefined)
  const launch = serverLaunch(config, 225000, { GGML_CUDA_DISABLE_GRAPHS: '1' }, 'win32')
  assert.equal(launch.options.env.GGML_CUDA_DISABLE_GRAPHS, undefined)
})

test('DSH schema accepts existing YAML settings and rejects non-boolean toggles', () => {
  const config = Config({ disableCudaGraphs: true, openConsole: false, proxyPort: 9010 })
  assert.equal(config.disableCudaGraphs.get(), true)
  assert.equal(config.openConsole.get(), false)
  assert.equal(config.proxyPort, 9010)
  assert.throws(() => Config({ disableCudaGraphs: 'false' }))
  assert.throws(() => Config({ openConsole: 'true' }))
})
