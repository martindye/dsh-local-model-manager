/** Build the Windows server launch; its environment applies only to Qwen. */
export function serverLaunch(config, contextSize, inheritedEnv) {
  if (!Number.isSafeInteger(contextSize) || contextSize <= 0) {
    throw new Error('contextSize must be a positive safe integer')
  }
  if (typeof config.disableCudaGraphs !== 'boolean') {
    throw new Error('disableCudaGraphs must be a boolean')
  }
  const env = { ...inheritedEnv }
  if (config.disableCudaGraphs) env.GGML_CUDA_DISABLE_GRAPHS = '1'
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-File', config.startScript, '-ContextSize', String(contextSize)],
    options: { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env },
  }
}
