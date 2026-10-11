import Schema from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'

const USER_DIR = homedir().replaceAll('\\', '/')

/** Startup defaults; graph and console preferences remain live references. */
export const DEFAULTS = {
  proxyHost: '127.0.0.1',
  proxyPort: 8081,
  targetHost: '127.0.0.1',
  targetPort: 8080,
  settingsPath: `${USER_DIR}/.dsh/profiles/web/cordis.patch.yml`,
  startScript: `${USER_DIR}/OneDrive/Projects/TurboQuantLlamaCppSetup/scripts/start-qwen3.8-27b-q6_0-turboquant-vision.ps1`,
  stopScript: `${USER_DIR}/OneDrive/Projects/TurboQuantLlamaCppSetup/scripts/stop-server.ps1`,
  logPath: `${USER_DIR}/.dsh/logs/local-model.log`,
  defaultContextSize: 225000,
  startTimeoutMs: 420000,
  pollMs: 2000,
  keepAliveMs: 15000,
  maxBodyBytes: 50 * 1024 * 1024,
  disableCudaGraphs: false,
  openConsole: true,
}

const fields = Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => {
  const schema = typeof value === 'boolean' ? Schema.boolean()
    : typeof value === 'number' ? Schema.number().min(1).step(1)
      : Schema.string()
  return [key, schema.default(value)]
}))
fields.disableCudaGraphs = fields.disableCudaGraphs.volatile()
fields.openConsole = fields.openConsole.volatile()

/** DSH settings form: editing launch preferences does not remount the proxy. */
export const Config = Schema.object(fields)
