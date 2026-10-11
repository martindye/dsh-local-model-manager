import Schema from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'

const USER_DIR = homedir().replaceAll('\\', '/')
const WINDOWS_SETUP = `${USER_DIR}/OneDrive/Projects/TurboQuantLlamaCppSetup/scripts`

/** Startup defaults; graph and console preferences remain live references. */
export const DEFAULTS = {
  proxyHost: '127.0.0.1',
  proxyPort: 8081,
  targetHost: '127.0.0.1',
  targetPort: 8080,
  settingsPath: `${USER_DIR}/.dsh/profiles/web/cordis.patch.yml`,
  startScript: process.platform === 'win32' ? `${WINDOWS_SETUP}/start-qwen3.8-27b-q6_0-turboquant-vision.ps1` : `${USER_DIR}/.dsh/local-model/start.sh`,
  stopScript: process.platform === 'win32' ? `${WINDOWS_SETUP}/stop-server.ps1` : `${USER_DIR}/.dsh/local-model/stop.sh`,
  logPath: `${USER_DIR}/.dsh/logs/local-model.log`,
  defaultContextSize: 225000,
  startTimeoutMs: 420000,
  pollMs: 2000,
  keepAliveMs: 15000,
  maxBodyBytes: 50 * 1024 * 1024,
  disableCudaGraphs: false,
  openConsole: true,
  manageServer: true,
  startCommand: '',
  stopCommand: '',
  commandCwd: '',
  terminalCommand: '',
  modelPath: '',
  projectorPath: '',
  servedModel: '',
  defaultModel: '',
  commandLogPath: `${USER_DIR}/.dsh/logs/llama-server.log`,
  targetApiKey: '',
  stopTimeoutMs: 20000,
  probeTimeoutMs: 4000,
  contextRounding: 4096,
}

const fields = Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => {
  const schema = typeof value === 'boolean' ? Schema.boolean()
    : typeof value === 'number' ? Schema.number().min(1).step(1)
      : Schema.string()
  return [key, schema.default(value)]
}))
fields.disableCudaGraphs = fields.disableCudaGraphs.volatile()
fields.openConsole = fields.openConsole.volatile()
fields.targetApiKey = fields.targetApiKey.role('secret')
fields.startArgs = Schema.array(Schema.string().required()).default([])
fields.stopArgs = Schema.array(Schema.string().required()).default([])
fields.terminalArgs = Schema.array(Schema.string().required()).default(['-e', '{command}', '{args}'])
fields.commandEnv = Schema.dict(Schema.string().required()).default({}).role('secret')
fields.modelContexts = Schema.dict(Schema.number().min(1).step(1).required()).default({})
fields.modelProfiles = Schema.dict(Schema.object({
  contextSize: Schema.number().min(1).step(1),
  modelPath: Schema.string(),
  projectorPath: Schema.string(),
  servedModel: Schema.string(),
  startCommand: Schema.string(),
  startArgs: Schema.array(Schema.string().required()),
})).default({})

/** DSH settings form: editing launch preferences does not remount the proxy. */
export const Config = Schema.object(fields)
