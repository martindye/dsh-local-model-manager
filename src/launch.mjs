import { fileURLToPath } from 'node:url'

const VISIBLE_LAUNCHER = fileURLToPath(new URL('./launch-visible.ps1', import.meta.url))

/** Read current DSH volatile values immediately before a future model launch. */
export function launchPreferences(config) {
  const current = (value, fallback) => value === undefined ? fallback
    : typeof value?.get === 'function' ? value.get() : value
  const disableCudaGraphs = current(config.disableCudaGraphs, false)
  const openConsole = current(config.openConsole, true)
  if (typeof disableCudaGraphs !== 'boolean') throw new Error('disableCudaGraphs must be a boolean')
  if (typeof openConsole !== 'boolean') throw new Error('openConsole must be a boolean')
  return { disableCudaGraphs, openConsole }
}

/** Build the Windows server launch; its environment applies only to Qwen. */
export function serverLaunch(config, contextSize, inheritedEnv) {
  if (!Number.isSafeInteger(contextSize) || contextSize <= 0) {
    throw new Error('contextSize must be a positive safe integer')
  }
  const { disableCudaGraphs, openConsole } = launchPreferences(config)
  const env = { ...inheritedEnv }
  if (disableCudaGraphs) env.GGML_CUDA_DISABLE_GRAPHS = '1'
  else delete env.GGML_CUDA_DISABLE_GRAPHS
  return {
    command: 'powershell.exe',
    args: openConsole
      ? ['-NoProfile', '-File', VISIBLE_LAUNCHER, '-StartScript', config.startScript, '-ContextSize', String(contextSize)]
      : ['-NoProfile', '-File', config.startScript, '-ContextSize', String(contextSize)],
    options: {
      // The visible path uses a hidden supervisor that starts a real console.
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      env,
    },
  }
}
