# @martin/dsh-local-model-manager

DSH profile plugin for on-demand **llama.cpp startup, model selection and context resizing**, with a loopback OpenAI-compatible proxy and launch settings UI. No DSH source patches are required.

## Version 0.2.0: portable launchers and model profiles

Configure literal executable/argument arrays on Windows, Linux or macOS, map dropdown entries to different weights and contexts, or use an externally managed llama.cpp server. The existing Windows/TurboQuant/Qwen configuration continues using its original scripts and defaults. CUDA graphs and the diagnostic window remain ON by default. Provider timeouts and voice CPU/GPU selection are unchanged.

See the [portable setup guide](docs/portable-setup.md) for commands, model profiles, terminal adapters, logging, authentication and external-server mode. Serving binaries, model weights, GPU libraries and installation-specific stop commands are not bundled. This release does not manage Ollama or vLLM.

| Area | Implementation and validation |
| --- | --- |
| Windows | Original PowerShell scripts retained; custom executable launchers support visible or hidden diagnostics. Native CPU-only process tests cover both paths. |
| Linux/macOS | Direct executable or `sh` script launchers; hidden diagnostics written to a file. Separate windows require a configured terminal adapter. Only launch-plan checks ran locally for these platforms; real model/GPU validation remains outstanding. |
| Server | One configured llama.cpp backend, probed through `/v1/models` and `/props`. Other OpenAI-compatible servers are not automatically lifecycle-compatible. |
| Model selection | Context-only dropdown entries retain fixed weights; optional `modelProfiles` switch weights by advertised alias, including equal-context models. |
| Real-model evidence | Earlier Windows/RTX 5090/TurboQuant `f6124e91`/Qwen3.8 27B Q6_K_L vision tests included near-full 225k and 350k contexts. Other models, hardware and operating systems need their own validation. |
| Node.js | Requires Node.js 20 or newer. Local tests ran on Windows Node.js 24.19.0; the optional CI template targets Node.js 20 across three platforms. |

## How it works

The plugin runs a proxy inside the DSH host at `127.0.0.1:8081`, forwarding `/v1/*` to the configured llama.cpp server at `127.0.0.1:8080`. Set the provider's `baseURL` to `http://127.0.0.1:8081/v1`.

On a request, the manager reads the selected dropdown entry's context. It adopts a matching server, starts an unavailable server, or stops and relaunches a mismatched server using the configured stop command. Streaming requests receive SSE keep-alives while startup finishes. Context allocation may round upward by less than `contextRounding` (4096 tokens by default). An unavailable context probe is trusted for an otherwise matching running server.

The backend stays running between requests and survives manager disposal. A new manager adopts it on the next request. Cancellation closes the upstream connection, releasing abandoned generation/prefill work. A failed stop that leaves the backend online prevents launching a replacement.

Use `manageServer: false` when another service owns startup and shutdown. The manager then never launches, stops or resizes it.

## Launch settings and diagnostics

Open **Plugins → @martin/dsh-local-model-manager** for **Enable CUDA graphs** and **Open diagnostic window**, both ON by default. The controls also appear in the bundle row's configuration page. They save live through DSH's settings service and affect future starts without remounting the proxy. They do not restart or change the window of a running model. Read-only connections show disabled controls.

The compatible YAML key `disableCudaGraphs` is the inverse of the positive UI switch. Enabling graphs removes `GGML_CUDA_DISABLE_GRAPHS` from the model child's environment; disabling sets it to `1`. The Host and voice environments remain untouched. Actual graph support depends on the llama.cpp build. See the [graph investigation and earlier measurements](docs/cuda-graphs.md); this release adds no CUDA backend patch or fresh model stress tests.

The original Windows launcher uses PowerShell `-File` with separate script/context arguments, respects execution policy and opens a visible diagnostic console. Custom Windows commands use a separate supervisor with literal native arguments, without encoded commands. Closing the model console can stop its process.

Proxy activity and failures go to `~/.dsh/logs/local-model.log`. Hidden custom/POSIX launches write stdout and stderr to `commandLogPath`, defaulting to `~/.dsh/logs/llama-server.log`. The legacy Windows script retains its own diagnostic logs and bounded stderr reporting. Its existing TurboQuant logs are beneath `OneDrive/Projects/TurboQuantLlamaCppSetup/logs`.

To watch an existing Windows log without restarting the model, run this from a visible PowerShell window in the plugin directory:

```powershell
powershell.exe -NoProfile -File src/watch-log.ps1 -LogPath 'C:\path\to\current-model.log'
```

The viewer defaults to UTF-16 (`Unicode`); supply `-Encoding UTF8` for UTF-8 logs. Closing the viewer leaves the model running.

## Install

```powershell
git clone https://github.com/martindye/dsh-local-model-manager.git
cd dsh-local-model-manager
npm ci
npm test
npm pack
```

From your DSH checkout, install the directory or generated archive:

```text
pnpm dsh plugin --profile web add <path-to-martin-dsh-local-model-manager-0.2.0.tgz>
```

Load the update by restarting the DSH host **after active work finishes**. Package name: `@martin/dsh-local-model-manager`; Cordis plugin ID: `local-model-manager`. Existing patches retain that ID. Directory/archive installation needs no npm registry publication.

The Windows defaults assume the existing scripts beneath the current user's `OneDrive/Projects/TurboQuantLlamaCppSetup/scripts`. Configure your own `startScript` and `stopScript`, or portable `startCommand`/`startArgs` and `stopCommand`/`stopArgs`, before using another installation. A custom launcher without a stop command can cold-start/adopt but refuses resizing before stopping anything. Review stop commands to ensure they target only the intended backend.

| Setting | Default / meaning |
| --- | --- |
| `settingsPath` | `~/.dsh/profiles/web/cordis.patch.yml`; YAML/JSON `id` and numeric `contextWindow` lookup, including quoted IDs and aliases. DSH expressions are never executed. |
| `defaultContextSize` | `225000`; choose a suitable size for another installation. |
| `modelContexts`, `modelProfiles`, `defaultModel` | Optional context/weight mappings and default profile; see the setup guide for precedence and alias handling. |
| `proxyHost` / `proxyPort` | `127.0.0.1` / `8081`. |
| `targetHost` / `targetPort` | `127.0.0.1` / `8080`. |
| `startTimeoutMs` | `420000` (seven minutes) for startup, separate from the provider's inference timeout. |
| `stopTimeoutMs`, `probeTimeoutMs` | `20000`, `4000` respectively. |
| `disableCudaGraphs`, `openConsole` | `false`, `true`; live preferences affecting future starts. |
| `targetApiKey`, `commandEnv` | Optional secret backend authorization and child environment configuration. |

For the original installation, no profile migration is needed. The separate `@martin/dsh-voice` CPU/Pocket preload correction remains in the voice plugin; this manager neither selects nor loads TTS engines. Existing 30-minute provider deadlines are outside this plugin and are preserved.

## Tests and limits

Run `npm test`. The 47 tests cover forwarding/cancellation, DSH schema and browser contributions, portable launch plans, YAML lookup, readiness deadlines, lifecycle failures, real CPU-only fixture startup/resize/model switching, authentication and adoption after manager disposal. Windows-only tests exercise the legacy PowerShell path and native argument quoting. Fixtures use isolated ephemeral ports and random shutdown tokens, with no model weights or VRAM allocations. An optional model-free CI template targets Windows, Linux and macOS; it has not run for this release. See [CI setup](ci/README.md).

Separate earlier React/jsdom and DSH Loader/Settings checks verified toggle writes, disabled controls and volatile-only settings projection. Complete browser/Host persistence remains outside automated coverage. Different terminal applications, real GPU backends and other models are not validated by CPU fixtures or launch-plan tests. No live production model is restarted as part of the 0.2.0 test suite.

## Rollback

1. Change the provider's `baseURL` back to `http://127.0.0.1:8080/v1`.
2. Run `pnpm dsh plugin --profile web remove @martin/dsh-local-model-manager`.
3. Restart the DSH host after active work finishes.
