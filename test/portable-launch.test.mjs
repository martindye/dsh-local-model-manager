import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serverLaunch, serverStop } from '../src/launch.mjs'

const base = { targetHost: '127.0.0.1', targetPort: 8080, disableCudaGraphs: false, openConsole: false }

for (const platform of ['win32', 'linux', 'darwin']) {
  test(`custom executable uses literal argv on ${platform}`, () => {
    const parent = { KEEP: 'parent', GGML_CUDA_DISABLE_GRAPHS: '0' }
    const config = { ...base, startCommand: '/models/llama-server', modelPath: "/models/A model's $name; &(test).gguf",
      startArgs: ['-m', '{modelPath}', '-c', '{contextSize}', '--host', '{host}', '--port', '{port}', '--alias', '{model}'],
      commandEnv: { KEEP: 'child' }, commandCwd: '/models' }
    const launch = serverLaunch(config, 350000, parent, platform, 'model A')
    assert.equal(launch.command, '/models/llama-server')
    assert.deepEqual(launch.args, ['-m', config.modelPath, '-c', '350000', '--host', '127.0.0.1', '--port', '8080', '--alias', 'model A'])
    assert.equal(launch.options.shell, false)
    assert.equal(launch.options.cwd, '/models')
    assert.equal(launch.options.env.KEEP, 'child')
    assert.equal(launch.options.env.GGML_CUDA_DISABLE_GRAPHS, undefined)
    assert.deepEqual(parent, { KEEP: 'parent', GGML_CUDA_DISABLE_GRAPHS: '0' })
  })
}

test('Windows custom visible launcher carries argv as data without encoded commands', () => {
  const config = { ...base, openConsole: true, startCommand: 'C:/Model tools/llama-server.exe',
    startArgs: ['-m', 'C:/a "quoted" model\\', '-c', '{contextSize}'] }
  const launch = serverLaunch(config, 225000, {}, 'win32')
  assert.equal(launch.command, 'powershell.exe')
  assert.match(launch.args[2], /launch-command-visible\.ps1$/)
  assert.deepEqual(JSON.parse(launch.options.env.DSH_LOCAL_MODEL_LAUNCH), {
    command: config.startCommand, args: ['-m', 'C:/a "quoted" model\\', '-c', '225000'], cwd: '',
  })
  assert(!launch.args.includes('-EncodedCommand'))
  assert(!launch.args.includes('-ExecutionPolicy'))
})

for (const platform of ['linux', 'darwin']) {
  test(`POSIX script and configured terminal on ${platform}`, () => {
    const config = { ...base, startScript: '/home/a path/start.sh', stopScript: '/home/a path/stop.sh' }
    assert.deepEqual(serverLaunch(config, 8192, {}, platform).args, [config.startScript, '8192'])
    assert.equal(serverLaunch(config, 8192, {}, platform).command, 'sh')
    assert.deepEqual(serverStop(config, 8192, {}, platform).args, [config.stopScript])
    const visible = serverLaunch({ ...config, openConsole: true, terminalCommand: 'terminal', terminalArgs: ['--', '{command}', '{args}'] }, 8192, {}, platform)
    assert.equal(visible.command, 'terminal')
    assert.deepEqual(visible.args, ['--', 'sh', config.startScript, '8192'])
    assert.throws(() => serverLaunch({ ...config, openConsole: true }, 8192, {}, platform), /terminalCommand/)
  })
}

test('custom launches require their own stop command before a resize', () => {
  const config = { ...base, startCommand: 'llama-server', startArgs: ['-c', '{contextSize}'], stopScript: 'broad-old-stop.ps1' }
  assert.throws(() => serverStop(config, 8192, {}, 'win32'), /stopCommand/)
  const stop = serverStop({ ...config, stopCommand: 'shutdown-one-server', stopArgs: ['--port', '{port}'] }, 8192, {}, 'linux')
  assert.equal(stop.command, 'shutdown-one-server')
  assert.deepEqual(stop.args, ['--port', '8080'])
  assert.equal(stop.options.shell, false)
})

test('bad argv, missing placeholders, and malformed environment fail before spawning', () => {
  const config = { ...base, startCommand: 'llama-server' }
  assert.throws(() => serverLaunch({ ...config, startArgs: '-m file' }, 8192, {}, 'linux'), /array/)
  assert.throws(() => serverLaunch({ ...config, startArgs: ['{modelPath}'] }, 8192, {}, 'linux'), /modelPath/)
  assert.throws(() => serverLaunch({ ...config, commandEnv: { BAD: null } }, 8192, {}, 'linux'), /commandEnv/)
  assert.throws(() => serverLaunch({ ...config, openConsole: true, terminalCommand: 'terminal', terminalArgs: ['{command} {args}'] }, 8192, {}, 'linux'), /separate/)
})
