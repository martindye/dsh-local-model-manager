# @martin/dsh-local-model-manager

DSH profile plugin: **on-demand lifecycle for the local llama.cpp Qwen
server, driven by the model dropdown, with zero changes to DSH.**

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
default is `false`; the supplied Windows/TurboQuant bundle explicitly
enables it. Set it to `false` to use the backend's normal graph policy.
Restart an already running Qwen server to apply it.

On the affected RTX 5090 setup, disabling graphs restored fast processing
of a 100k-token prompt while keeping the GPU voice model loaded. It is a
workaround for the observed runtime behaviour, not a diagnosis of a
particular driver or llama.cpp defect. Token generation may be slightly
slower without graphs. The 30-minute DSH stream-idle deadline stays intact.

The server launches hidden through PowerShell `-File`, passing the script
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
npm test
npm pack
```

From your DSH checkout, add the resulting `martin-dsh-local-model-manager-0.1.1.tgz`
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

- Pure Node built-ins, zero dependencies.
- The proxy only understands `/v1/*`; anything else gets a 404.
- Model→context mapping is read from `settingsPath` per request
  (the single source of truth; no duplicated table here).
- Unknown model ids fall back to `defaultContextSize` (225000).
