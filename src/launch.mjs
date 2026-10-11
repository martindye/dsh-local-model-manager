import { fileURLToPath } from 'node:url'

const VISIBLE_LAUNCHER = fileURLToPath(new URL('./launch-visible.ps1', import.meta.url))
const COMMAND_VISIBLE_LAUNCHER = fileURLToPath(new URL('./launch-command-visible.ps1', import.meta.url))

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

function stringArray(value, name) {
  if (!Array.isArray(value) || value.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error(`${name} must be an array of argument strings`)
  }
  return value
}

function commandValue(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${name} must be a nonempty executable or script path`)
  return value
}

/** Expand known placeholders in argument values; never evaluate a shell string. */
export function commandArguments(args, config, contextSize, modelId = '') {
  const values = {
    contextSize, model: modelId, host: config.targetHost ?? '127.0.0.1', port: config.targetPort ?? 8080,
    modelPath: config.modelPath, projectorPath: config.projectorPath, servedModel: config.servedModel || modelId,
  }
  return stringArray(args, 'command arguments').map(arg => arg.replace(
    /\{(contextSize|model|host|port|modelPath|projectorPath|servedModel)\}/g,
    (_match, key) => {
      if (values[key] === undefined || values[key] === '') throw new Error(`No value configured for {${key}}`)
      return String(values[key])
    },
  ))
}

function options(config, inheritedEnv) {
  const extra = config.commandEnv ?? {}
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)
    || Object.entries(extra).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0'))) {
    throw new Error('commandEnv must contain named string environment values')
  }
  return {
    windowsHide: true, detached: false, shell: false,
    stdio: ['ignore', 'ignore', 'pipe'],
    ...(config.commandCwd ? { cwd: config.commandCwd } : {}),
    env: { ...inheritedEnv, ...extra },
  }
}

/** Build a portable model launch, retaining the existing Windows script path. */
export function serverLaunch(config, contextSize, inheritedEnv, platform = process.platform, modelId = '') {
  if (!Number.isSafeInteger(contextSize) || contextSize <= 0) {
    throw new Error('contextSize must be a positive safe integer')
  }
  const { disableCudaGraphs, openConsole } = launchPreferences(config)
  const launchOptions = options(config, inheritedEnv)
  if (disableCudaGraphs) launchOptions.env.GGML_CUDA_DISABLE_GRAPHS = '1'
  else delete launchOptions.env.GGML_CUDA_DISABLE_GRAPHS
  const custom = Boolean(config.startCommand)
  // POSIX backends get their own session; direct-launch diagnostics use a file
  // or /dev/null so host disposal cannot break the backend's stderr pipe.
  if (platform !== 'win32') launchOptions.detached = true
  const command = custom ? commandValue(config.startCommand, 'startCommand') : platform === 'win32' ? 'powershell.exe' : 'sh'
  const args = custom ? commandArguments(config.startArgs ?? [], config, contextSize, modelId)
    : platform === 'win32'
      ? ['-NoProfile', '-File', commandValue(config.startScript, 'startScript'), '-ContextSize', String(contextSize)]
      : [commandValue(config.startScript, 'startScript'), String(contextSize)]
  if (!openConsole) {
    const separate = custom || platform !== 'win32'
    if (separate) launchOptions.stdio = ['ignore', 'ignore', 'ignore']
    return { command, args, options: launchOptions, ...(separate && config.commandLogPath ? { diagnosticPath: config.commandLogPath } : {}) }
  }
  if (platform !== 'win32') {
    const terminal = commandValue(config.terminalCommand, 'terminalCommand (required for openConsole on Linux/macOS; or set openConsole: false)')
    const terminalArgs = stringArray(config.terminalArgs ?? ['-e', '{command}', '{args}'], 'terminalArgs')
    if (!terminalArgs.includes('{command}') || !terminalArgs.includes('{args}')) {
      throw new Error('terminalArgs must contain separate {command} and {args} entries')
    }
    return { command: terminal, args: terminalArgs.flatMap(arg => arg === '{command}' ? [command] : arg === '{args}' ? args : [arg]), options: launchOptions }
  }
  if (custom) {
    launchOptions.env.DSH_LOCAL_MODEL_LAUNCH = JSON.stringify({ command, args, cwd: config.commandCwd || '' })
    return { command: 'powershell.exe', args: ['-NoProfile', '-File', COMMAND_VISIBLE_LAUNCHER], options: launchOptions }
  }
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-File', VISIBLE_LAUNCHER, '-StartScript', config.startScript, '-ContextSize', String(contextSize)],
    options: launchOptions,
  }
}

/** Build an explicitly configured stop command, or the matching legacy script. */
export function serverStop(config, contextSize, inheritedEnv, platform = process.platform, modelId = '') {
  const launchOptions = options(config, inheritedEnv)
  if (config.stopCommand) return {
    command: commandValue(config.stopCommand, 'stopCommand'),
    args: commandArguments(config.stopArgs ?? [], config, contextSize, modelId), options: launchOptions,
  }
  if (config.startCommand) throw new Error('Configure stopCommand/stopArgs before resizing or switching a custom-launched model; the running server was left untouched')
  return {
    command: platform === 'win32' ? 'powershell.exe' : 'sh',
    args: platform === 'win32' ? ['-NoProfile', '-File', commandValue(config.stopScript, 'stopScript')]
      : [commandValue(config.stopScript, 'stopScript')],
    options: launchOptions,
  }
}
