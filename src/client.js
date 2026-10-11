/* DSH browser contribution, using its module table; no separate build required. */
window.__ModuleLoader__.load({
  id: '@martin/dsh-local-model-manager',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const NS = 'martin.localModelManager'
    const PACKAGE = '@martin/dsh-local-model-manager'
    const ENTRY = 'local-model-manager'
    const en = {
      title: 'Model launch options',
      summary: 'CUDA graphs and the diagnostic window for future model launches.',
      graphs: 'Enable CUDA graphs',
      console: 'Open diagnostic window',
      applies: 'Changes are saved immediately and apply to the next model launch. The running model is left untouched.',
      loading: 'Loading model launch options…',
      unavailable: 'Model launch options are unavailable on this connection.',
      readOnly: 'These options are read-only on this connection.',
      saving: 'Saving…',
      saved: 'Saved for the next model launch.',
      failed: 'Could not save. The accepted settings are shown; try again.',
    }
    const zh = {
      title: '模型启动选项',
      summary: '设置下次模型启动时的 CUDA 图和诊断窗口。',
      graphs: '启用 CUDA 图',
      console: '打开诊断窗口',
      applies: '更改会立即保存，并在下次模型启动时生效。当前运行的模型不受影响。',
      loading: '正在加载模型启动选项…',
      unavailable: '此连接无法使用模型启动选项。',
      readOnly: '此连接上的选项为只读。',
      saving: '正在保存…',
      saved: '已保存，将在下次模型启动时生效。',
      failed: '无法保存。显示的是已接受的设置，请重试。',
    }

    function LaunchOptions({ launchForm: form, t, view }) {
      const state = React.useSyncExternalStore(
        (listener) => form.subscribe(listener),
        () => form.getSnapshot(),
        () => form.getSnapshot(),
      )
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      if (view === 'summary') return t('summary')
      if (state.status !== 'ready') return h('p', null, t(state.status === 'loading' ? 'loading' : 'unavailable'))
      const disabled = busy || !state.writable
      const save = async (field, value) => {
        if (disabled) return
        setBusy(true)
        setNotice('saving')
        try {
          setNotice(await form.set(field, value) ? 'saved' : 'failed')
        } catch (error) {
          // Form recovery keeps accepted values after a transport failure.
          setNotice('failed')
        } finally {
          setBusy(false)
        }
      }
      const toggle = (label, checked, field, invert = false) => h('label', {
        key: field, style: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0' },
      }, h('input', {
        type: 'checkbox', checked, disabled, 'aria-describedby': 'local-model-manager-applies',
        onChange: (event) => save(field, invert ? !event.target.checked : event.target.checked),
      }), t(label))
      return h('section', { 'aria-label': t('title') },
        h('h3', null, t('title')),
        toggle('graphs', state.value?.disableCudaGraphs !== true, 'disableCudaGraphs', true),
        toggle('console', state.value?.openConsole !== false, 'openConsole'),
        h('p', { id: 'local-model-manager-applies' }, t('applies')),
        !state.writable && h('p', null, t('readOnly')),
        notice && h('p', { role: notice === 'failed' ? 'alert' : 'status', 'aria-live': 'polite' }, t(notice)),
      )
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const form = ctx.configForms.get(ENTRY)
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'local-model-manager: dictionaries')
        ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => {
          const register = (name, key) => ctx.slots.inject(name, () => ctx.slots.register({
            name, key, locale: NS, inject: () => ({ launchForm: form }),
          }, LaunchOptions))
          const disposers = [
            register('plugins.bundle.config', PACKAGE),
            register('plugins.row.config', `${PACKAGE}#${ENTRY}`),
          ]
          return () => { for (const dispose of disposers) dispose() }
        }), 'local-model-manager: launch settings')
      },
    }
  },
})
