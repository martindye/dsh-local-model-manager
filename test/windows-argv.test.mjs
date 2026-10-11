import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serverLaunch } from '../src/launch.mjs'
import { removeTestDirectory } from './cleanup.mjs'

test('Windows visible command helper round-trips literal argv and exit code', { skip: process.platform !== 'win32', timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'model-argv-'))
  t.after(() => removeTestDirectory(directory))
  const output = join(directory, 'argv.json')
  const worker = join(directory, 'argv worker.mjs')
  const wrapper = join(directory, 'hidden test wrapper.ps1')
  const helper = fileURLToPath(new URL('../src/launch-command-visible.ps1', import.meta.url))
  writeFileSync(worker, "import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[2], JSON.stringify({args:process.argv.slice(3),spec:process.env.DSH_LOCAL_MODEL_LAUNCH ?? null,cwd:process.cwd()})); process.exitCode=7;\n")
  // Exercise the real native quoting without opening a test window. Only this
  // isolated PowerShell process overrides Start-Process's WindowStyle.
  writeFileSync(wrapper, "param([string]$Helper)\nfunction Start-Process { param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru,$WorkingDirectory) $PSBoundParameters.WindowStyle='Hidden'; Microsoft.PowerShell.Management\\Start-Process @PSBoundParameters }\n. $Helper\nexit $LASTEXITCODE\n")
  const argv = ['', "a path's $name; &(test).gguf", 'a "quoted" value', 'backslash-before-quote\\"', 'trailing slash\\', 'literal{unknown}']
  const launch = serverLaunch({ startCommand: process.execPath, startArgs: [worker, output, ...argv],
    commandCwd: directory, openConsole: true, disableCudaGraphs: false }, 8192, process.env, 'win32')
  const child = spawn('powershell.exe', ['-NoProfile', '-File', wrapper, '-Helper', helper], launch.options)
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  assert.equal(exit, 7, stderr)
  const recorded = JSON.parse(readFileSync(output, 'utf8'))
  assert.deepEqual(recorded.args, argv)
  assert.equal(recorded.spec, null)
  assert.equal(recorded.cwd, directory)
})
