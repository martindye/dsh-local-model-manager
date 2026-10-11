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
      summary: 'CUDA graphs restored on the tested Windows/Qwen setup and enabled by default. Configure future model launches here.',
      graphs: 'Enable CUDA graphs',
      graphsStatus: 'CUDA graphs slowdown fixed on the tested Windows/Qwen setup.',
      graphsDetail: 'Graphs ON passed 225k and 350k context tests on Windows/RTX 5090/Qwen and remain enabled by default. Other setups need their own validation.',
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
      summary: '已在测试的 Windows/Qwen 配置上恢复 CUDA 图，默认开启。在此设置下次模型启动选项。',
      graphs: '启用 CUDA 图',
      graphsStatus: '已在测试的 Windows/Qwen 配置上解决 CUDA 图相关的性能下降。',
      graphsDetail: '已在 Windows/RTX 5090/Qwen 配置上通过开启 CUDA 图的 225k 和 350k 上下文测试，CUDA 图保持默认开启。其他配置仍需单独验证。',
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
        type: 'checkbox', checked, disabled, 'aria-describedby': invert
          ? 'local-model-manager-graphs-status local-model-manager-graphs-detail local-model-manager-applies'
          : 'local-model-manager-applies',
        onChange: (event) => save(field, invert ? !event.target.checked : event.target.checked),
      }), t(label))
      return h('section', { 'aria-label': t('title') },
        h('h3', null, t('title')),
        toggle('graphs', state.value?.disableCudaGraphs !== true, 'disableCudaGraphs', true),
        h('p', { id: 'local-model-manager-graphs-status' }, h('strong', null, t('graphsStatus'))),
        h('p', { id: 'local-model-manager-graphs-detail' }, t('graphsDetail')),
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
