# @martin/dsh-local-model-manager

DSH profile plugin: **on-demand lifecycle for the local llama.cpp Qwen
server, driven by the model dropdown, with zero changes to DSH.**

## Current scope and maturity

Version 0.1.3 is an early Windows/Qwen-focused release. Its proxy and
cancellation logic are reusable, but its launch mechanism and server probes
assume the setup described below. Compatibility with other operating systems,
GPU types, models, or serving backends has not been established.

| Area | Current implementation and validation |
| --- | --- |
| Operating system | Windows; launches `powershell.exe`. Linux and macOS lifecycle support is not implemented or tested. |
| Server | One configured llama.cpp-compatible backend, checked through `/v1/models` and `/props`. OpenAI API compatibility alone does not establish lifecycle compatibility. |
| Live validation | Windows, NVIDIA RTX 5090, TurboQuant llama.cpp build `f6124e91`, Qwen3.8 27B Q6_K_L with its vision projector; near-full 225k and 350k context tests with GPU voice absent. |
| Node.js | Package declares Node.js 20 or newer; current local tests ran on Node.js 24.19.0. Other declared versions have not been validated. |
| Launch scripts | Existing local PowerShell start/stop scripts supplied by the installer; neither scripts nor model weights are bundled. |
| Model selection | Reads the selected model ID's context size and resizes the configured server. The external start script determines the weights and GPU arguments; the plugin does not automatically switch model files. |
| CUDA graphs | Optional workaround observed on the tested Windows/TurboQuant setup; results have not been established across other hardware or builds. |

The default script paths assume a TurboQuant installation beneath the current
user's `OneDrive/Projects/TurboQuantLlamaCppSetup`. Configure your own paths
before using a different installation. The proxy serves `/v1/*` on loopback;
this release manages one backend and leaves it running between requests.

### Test coverage and limits

Eighteen automated tests cover five HTTP proxy behaviours, six launcher
argument/environment checks, two native configuration-schema checks and five
browser contribution checks. They cover cancellation, normal and interrupted
responses, live launch preferences, child-only environment changes, UI writes,
read-only connections and rejected writes. The HTTP tests use local mock
servers; no automated test starts a real model. Browser checks use a stub
renderer and settings service, rather than an end-to-end DSH browser session.

Separate 0.1.3 smoke checks used real React/jsdom controls to exercise both
toggle writes, read-only state and clean unmount. Checks against the local
DSH Loader and Settings source confirmed volatile-only edits avoid remounting
and expose both preferences as plain booleans. The active DSH host was not
reloaded for these checks; complete browser/Host persistence remains outside
the automated coverage.

Separate manual checks on the setup above exercised a real plugin cold start,
long-prompt processing, and cancellation followed by another request. These
checks provide evidence for that configuration, rather than a compatibility
matrix. Real start/stop/resize orchestration and DSH host reloads are not
covered by the automated tests.

For 0.1.2, a separate Windows smoke test used a dummy start script to confirm
that the visible launcher displays stdout, native stderr, and PowerShell host
messages. A live log viewer was also checked against an already running model
without restarting it. These checks do not add other platforms to the support
scope.

Portable launch commands, backend-specific lifecycle checks, and broader
orchestration and platform tests remain future work. No compatibility claim
is made for other OpenAI-compatible backends merely because their requests
can be proxied.

## How it works

- Runs a small OpenAI-compatible proxy at `127.0.0.1:8081` *inside the DSH
  host process* (it dies with the harness; nothing extra to manage).
- DSH points at it with one line in `~/.dsh/settings.yaml`:
  `baseURL: http://127.0.0.1:8081/v1` in the provider configuration.
- First message after a reboot: the proxy starts the server via
  `start-qwen3.8-27b-q6_0-turboquant-vision.ps1 -ContextSize <N>`, where N is
  the selected dropdown entry's `contextWindow` from the configured `settingsPath`. The
  request is held open (SSE keep-alives for streaming) until the model is up.
- Change the dropdown, send a new message → if the running server's
  `n_ctx` (from `/props`, allowing llama's round-up) doesn't match, the
  proxy stops the server (`stop-server.ps1`) and restarts it with the new
  `-ContextSize`.
- Nothing ever auto-stops the server. A server started by the plugin
  outlives a harness restart and is adopted on the next probe.
- Log: `~/.dsh/logs/local-model.log`.

### Diagnostics and console window

From 0.1.2, `openConsole` defaults to `true`. The plugin uses a hidden
supervisor to start the configured PowerShell script in a separate visible
console with its diagnostic output connected to that window. The supervisor
waits for the script and propagates its exit code. Closing the model's own
console can stop the model.

To choose the behaviour, add this setting to the `local-model-manager` row in
your web profile's `cordis.patch.yml`:

```yaml
- id: local-model-manager
  config:
    openConsole: true
```

Set `openConsole: false` to launch hidden. The value must be a boolean. The
option controls future starts: it does not restart a model or change the
window of an already running process. From 0.1.3 the setting is also available
on the plugin's settings page and updates live without remounting the proxy.
The DSH host must load the plugin update once to register its new settings;
do that after active work has finished.

`~/.dsh/logs/local-model.log` contains proxy activity, startup progress, and
launcher failures. In hidden mode, the plugin discards launcher stdout and
captures the last 4000 characters of stderr for reporting when the launcher
exits unsuccessfully. In visible mode, the model script's diagnostics go to
its window and any script-owned logs; the plugin captures supervisor errors.
The plugin log is not a complete llama.cpp diagnostic transcript.

The existing TurboQuant start script writes its own llama.cpp diagnostic files
under `OneDrive/Projects/TurboQuantLlamaCppSetup/logs`. Use the newest log there
for backend details. If you supply a different start script, its own logging
must preserve the diagnostic output you need.

For an existing hidden process with a diagnostic log, open a separate live
viewer without restarting the model:

```powershell
powershell.exe -NoProfile -File src/watch-log.ps1 -LogPath 'C:\path\to\current-model.log'
```

Run that command from the plugin directory in a visible PowerShell window.
The viewer defaults to UTF-16 (`Unicode`) for the existing Windows PowerShell
TurboQuant logs; use `-Encoding UTF8` for UTF-8 logs. Closing the viewer leaves
the model running. It reads a file and does not restore output that was never
logged.

## 0.1.3: graphs enabled and launch settings UI

Open **Plugins → @martin/dsh-local-model-manager** to choose **Enable CUDA
graphs** and **Open diagnostic window**. Both default to ON. The same controls
are available from the bundle's `local-model-manager` row configuration page.
Changes save immediately through DSH's revisioned settings service and affect
the next model launch. They do not stop, restart, resize or hide a running
model. A connection without writable Host settings shows disabled controls.

The existing YAML key `disableCudaGraphs` is retained for compatibility:
the UI's positive **Enable CUDA graphs** switch writes its inverse. Enabling
graphs removes `GGML_CUDA_DISABLE_GRAPHS` only from the future model child's
environment, including an inherited value of `0`; disabling sets it to `1`.
The Host and voice environments are unchanged. The backend must have graph
support compiled in for the enabled preference to have an effect.

This UI requires DSH's volatile configuration support and
`@deepseek-ai/schemastery` 3.18.4 or newer within the 3.x series. The plugin uses
the Host's shared settings, locale and Plugins services; it does not patch
DSH or require a separate client build.

## 0.1.2: configurable diagnostic console

- Visible model console is now the default (`openConsole: true`).
- `openConsole: false` preserves hidden startup.
- Included live log viewer provides diagnostics for an existing hidden process.
- Cancellation, graph settings, context sizing, and voice selection are unchanged.

## 0.1.1: cancellation and timeouts

When a user stops generation or DSH's stream-idle timeout expires, the
proxy closes the upstream llama-server connection too. This releases the
single model slot instead of leaving abandoned prefills ahead of new work.
Requests abandoned while the server is starting are not forwarded when it
becomes ready. Normal completion and provider errors retain their existing
streaming and non-streaming behaviour.

This release does not change provider timeouts, context sizes, model
parameters, or voice plugins. The host must restart to load the update.

### Optional CUDA graph workaround

For the persistent long-prompt slowdown observed with the TurboQuant Qwen
server on Windows, set `disableCudaGraphs: true` in the
`local-model-manager` plugin's config. The plugin sets
`GGML_CUDA_DISABLE_GRAPHS=1` only in the Qwen launch environment; voice
servers and the DSH host keep their own settings. The plugin's fallback
default and supplied bundle are now `false` (graphs ON). The earlier 0.1.1
and 0.1.2 bundles used `true` as a mitigation. From 0.1.3, `false` clears the
disable variable in the model child's environment. The preference takes
effect on the next backend launch; changing it does not trigger a restart.

This option turns CUDA graphs off while keeping Qwen on the GPU. It does not
select CPU inference or change a voice plugin's CPU/GPU TTS selection.

The option is named **disableCudaGraphs**: turning this option on turns CUDA
graphs off. In the tested backend, any inherited `GGML_CUDA_DISABLE_GRAPHS`
value disables graphs, including `0`. The log's `graphs reused` counter is
llama.cpp computation-graph reuse and does not establish CUDA graph activity.
See the [graph investigation and completed validation](docs/cuda-graphs.md)
for measurements, upstream findings, and the remaining backend investigation.

Subsequent maintenance tests completed fresh 224k and 348k prompts with CUDA
graphs ON using the unchanged backend and CPU voice selected. At 350k, prefill
was within 1% of graphs OFF and generation was about 6% faster in the single
comparison. The 350k stress sequence reached only 201 MiB free VRAM after other
applications were closed. These results apply to that installation and workload.
The separate `@martin/dsh-voice` preload correction is not bundled with this
model manager; this plugin does not configure TTS or select its device.
The supplied bundle now enables graphs. If the original stall recurs, turn
**Enable CUDA graphs** OFF or set `disableCudaGraphs: true`, then relaunch
the backend only after active work has ended.

On the affected RTX 5090 setup, disabling graphs restored fast processing
of a 100k-token prompt while keeping the GPU voice model loaded. It is a
workaround for the observed runtime behaviour, not a diagnosis of a
particular driver or llama.cpp defect. Token generation may be slightly
slower without graphs. The plugin does not set DSH's stream-idle timeout;
the tested profile's existing 30-minute deadline was preserved.

The server launches through PowerShell `-File`, passing the script
path and context as separate arguments and respecting the configured execution
policy. An experimental encoded launcher was removed after Defender flagged
a diagnostic command on the affected Windows setup. Paths are
configurable; their defaults resolve against the current user's home
directory rather than a fixed user name. `settingsPath` defaults to
`~/.dsh/profiles/web/cordis.patch.yml`.

Launcher failures are logged and reported promptly. Windows `RemoteSigned`
policy can block an unsigned script marked as downloaded. Review the configured
script and scan it before using PowerShell's `Unblock-File` on that specific
file; the plugin does not unblock files or change execution policy.

Run `npm test` to check cancellation during prefill and generation, normal
completion, non-streaming errors, and interrupted upstream streams. Run
`npm pack` to create an installable plugin archive. Install that archive
using `pnpm dsh plugin --profile web add <archive-path>`.

## Install

```
pnpm dsh plugin --profile web add <plugin-directory-or-tgz>
```

To install from this repository:

```powershell
git clone https://github.com/martindye/dsh-local-model-manager.git
cd dsh-local-model-manager
npm ci
npm test
npm pack
```

From your DSH checkout, add the resulting `martin-dsh-local-model-manager-0.1.3.tgz`
using the command above, then restart the web host. The package name is scoped;
the Cordis plugin ID remains `local-model-manager` so existing configuration
patches still apply. This repository is the source distribution; an npm registry
publication is not required for directory or archive installation.

Configure `settingsPath`, `startScript`, `stopScript`, and `logPath` in the
`local-model-manager` row of your web profile's `cordis.patch.yml`. The default
scripts use the existing Windows TurboQuant setup beneath the current user's
`OneDrive/Projects/TurboQuantLlamaCppSetup`; those scripts and model weights are
not bundled. The start script must accept `-ContextSize`, and the stop script
must stop the intended server. Point the provider's `baseURL` at
`http://127.0.0.1:8081/v1`.

### Configuration contract

| Setting or interface | Required behaviour / default |
| --- | --- |
| `startScript` | Local `.ps1` file accepting a positive integer `-ContextSize`; starts the configured backend. Execution respects Windows policy. |
| `openConsole` | `true` by default, including the bundled patch. Opens a visible model console on a future start; `false` starts hidden. Existing processes are not restarted or shown by changing this setting. |
| `stopScript` | Local `.ps1` file stopping the intended backend. Process selection belongs to this script; review it before use alongside other model servers. |
| `settingsPath` | Defaults to `~/.dsh/profiles/web/cordis.patch.yml`. Context lookup uses a simple line reader expecting an unquoted `- id: <model-id>` followed by a numeric `contextWindow:`; full YAML syntax, aliases, and computed values are not supported. |
| `defaultContextSize` | `225000` tokens, used when the request has no model ID or no matching numeric context entry can be read. Choose a value appropriate for your model and hardware. |
| `proxyHost` / `proxyPort` | `127.0.0.1` / `8081`. |
| `targetHost` / `targetPort` | `127.0.0.1` / `8080`. |
| `startTimeoutMs` | `420000` ms (seven minutes) to become ready; nonzero launcher exits are reported earlier. This is separate from DSH's inference timeout. |
| `logPath` | Defaults to `~/.dsh/logs/local-model.log`. |
| Context probe | Reads numeric `default_generation_settings.n_ctx` from `/props`, with top-level `n_ctx` as a fallback. Allows rounding up by less than 4096 tokens. If context is unavailable, an already running server is trusted without resizing. |
| `disableCudaGraphs` | `false` in both the component and bundle (graphs ON). Live UI preference; `true` disables graphs on the next launch. |

For profiles installed under the previous unscoped name, replace
`dsh-local-model-manager` with `@martin/dsh-local-model-manager` in the profile's
dependency and bundle entries after installing the scoped package.

## Rollback

1. `settings.yaml`: `baseURL` back to `http://127.0.0.1:8080/v1`.
2. `pnpm dsh plugin --profile web remove @martin/dsh-local-model-manager`
   (or just delete its row from `dsh.profile.bundles` in
   `~/.dsh/profiles/web/package.json`).
3. Restart the gateway.

## Design notes

- Node built-ins for the proxy, plus DSH's shared Schemastery peer for live settings.
- The proxy only understands `/v1/*`; anything else gets a 404.
- Model→context mapping is read from `settingsPath` per request
  (the single source of truth; no duplicated table here).
- Unknown model ids fall back to `defaultContextSize` (225000).
