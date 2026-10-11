import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contextFromSettings, modelRequest } from '../src/models.mjs'
import { removeTestDirectory } from './cleanup.mjs'

test('YAML quoted ids, anchors, nested providers and JSON model contexts are read', t => {
  const directory = mkdtempSync(join(tmpdir(), 'model-context-'))
  t.after(() => removeTestDirectory(directory))
  const file = join(directory, 'settings.yml')
  writeFileSync(file, '- config:\n    models:\n      - &entry\n        id: "model with spaces"\n        contextWindow: 225000\n      - *entry\n')
  assert.equal(contextFromSettings(file, 'model with spaces'), 225000)
  writeFileSync(file, JSON.stringify({ models: [{ id: 'model-b', contextWindow: 350000 }] }))
  assert.equal(contextFromSettings(file, 'model-b'), 350000)
  writeFileSync(file, '&loop { self: *loop }')
  assert.equal(contextFromSettings(file, 'absent'), null)
  writeFileSync(file, 'invalid: [')
  assert.equal(contextFromSettings(file, 'absent'), null)
  writeFileSync(file, '- id: model\n  contextWindow: 8192\n  disabled: !!js process.exit(99)\n')
  assert.equal(contextFromSettings(file, 'model'), 8192)
})

test('explicit profiles and contexts take priority without mutating base config', () => {
  const config = { defaultContextSize: 225000, startCommand: 'llama-server', modelContexts: { a: 64000 },
    modelProfiles: { a: { contextSize: 8192, modelPath: '/models/a.gguf', startArgs: ['-m', '{modelPath}'] } } }
  const request = modelRequest(config, 'a')
  assert.equal(request.contextSize, 8192)
  assert.equal(request.servedModel, 'a')
  assert.equal(request.config.modelPath, '/models/a.gguf')
  assert.equal(config.modelPath, undefined)
  assert.equal(modelRequest({ ...config, modelProfiles: {} }, 'a').contextSize, 64000)
  assert.equal(modelRequest(config, 'other').contextSize, 225000)
  assert.equal(modelRequest({ ...config, defaultModel: 'a' }, null).contextSize, 8192)
  assert.equal(modelRequest({ ...config, servedModel: 'global-alias' }, 'a').servedModel, 'a')
})

test('weights profiles cannot silently use a legacy script that ignores modelPath', () => {
  assert.throws(() => modelRequest({ defaultContextSize: 8192, modelProfiles: { a: { modelPath: '/models/a.gguf' } } }, 'a'), /startCommand/)
  assert.throws(() => modelRequest({ defaultContextSize: -1 }, 'a'), /positive/)
})
