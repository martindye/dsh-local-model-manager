import { fileURLToPath } from 'node:url'

const VISIBLE_LAUNCHER = fileURLToPath(new URL('./launch-visible.ps1', import.meta.url))

/** Build the Windows server launch; its environment applies only to Qwen. */
export function serverLaunch(config, contextSize, inheritedEnv) {
  if (!Number.isSafeInteger(contextSize) || contextSize <= 0) {
    throw new Error('contextSize must be a positive safe integer')
  }
  if (typeof config.disableCudaGraphs !== 'boolean') {
    throw new Error('disableCudaGraphs must be a boolean')
  }
  const openConsole = config.openConsole === undefined ? true : config.openConsole
  if (typeof openConsole !== 'boolean') {
    throw new Error('openConsole must be a boolean')
  }
  const env = { ...inheritedEnv }
  if (config.disableCudaGraphs) env.GGML_CUDA_DISABLE_GRAPHS = '1'
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
