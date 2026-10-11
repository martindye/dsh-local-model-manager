import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function fixture({ writable = true, accepted = true, reject = false } = {}) {
  let plugin
  let dictionaries
  const entries = []
  const writes = []
  const state = { status: 'ready', writable, value: { disableCudaGraphs: false, openConsole: true } }
  const form = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    async set(field, value) {
      writes.push([field, value])
      if (reject) throw new Error('offline')
      if (accepted) state.value[field] = value
      return accepted
    },
  }
  // Pure component rendering; these tests do not start DSH or a model.
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useSyncExternalStore: (_subscribe, get) => get(),
    useState: (initial) => [initial, () => {}],
  }
  vm.runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (entry) => { plugin = entry.factory((name) => {
      assert.equal(name, 'react')
      return React
    }) } } },
  })
  const ctx = {
    effect: (factory) => factory(),
    locale: { register: (_ns, copy) => { dictionaries = copy; return () => {} } },
    configForms: {
      get: (entry) => { assert.equal(entry, 'local-model-manager'); return form },
      whileServed: (_entries, register) => register(),
    },
    slots: {
      inject: (_name, factory) => factory(),
      register: (options, Component) => { entries.push({ options, Component }); return () => {} },
    },
  }
  plugin.apply(ctx)
  const render = () => entries[0].Component({ ...entries[0].options.inject(), t: (key) => dictionaries.en[key], view: 'page' })
  const inputs = () => render().children.filter(child => child?.type === 'label').map(child => child.children[0])
  return { entries, inputs, writes, state, render }
}

test('launch controls are registered on bundle and row configuration pages', () => {
  const f = fixture()
  assert.deepEqual(f.entries.map(entry => [entry.options.name, entry.options.key]), [
    ['plugins.bundle.config', '@martin/dsh-local-model-manager'],
    ['plugins.row.config', '@martin/dsh-local-model-manager#local-model-manager'],
  ])
  assert.equal(f.inputs()[0].props.checked, true)
  assert.equal(f.inputs()[1].props.checked, true)
})

test('positive graphs toggle saves the inverse existing config without restarting a model', async () => {
  const f = fixture()
  await f.inputs()[0].props.onChange({ target: { checked: false } })
  assert.deepEqual(f.writes, [['disableCudaGraphs', true]])
  assert.equal(f.inputs()[0].props.checked, false)
  await f.inputs()[0].props.onChange({ target: { checked: true } })
  assert.deepEqual(f.writes[1], ['disableCudaGraphs', false])
})

test('console toggle saves independently of graph and voice settings', async () => {
  const f = fixture()
  await f.inputs()[1].props.onChange({ target: { checked: false } })
  assert.deepEqual(f.writes, [['openConsole', false]])
  assert.equal(f.state.value.disableCudaGraphs, false)
})

test('read-only connections disable both controls and cannot write', async () => {
  const f = fixture({ writable: false })
  for (const input of f.inputs()) {
    assert.equal(input.props.disabled, true)
    await input.props.onChange({ target: { checked: false } })
  }
  assert.deepEqual(f.writes, [])
})

test('refused and failed writes continue showing accepted graph settings', async () => {
  for (const options of [{ accepted: false }, { reject: true }]) {
    const f = fixture(options)
    await f.inputs()[0].props.onChange({ target: { checked: false } })
    assert.equal(f.inputs()[0].props.checked, true)
  }
})
