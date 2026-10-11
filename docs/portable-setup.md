# Portable llama.cpp setup

Version 0.2.0 supports configurable llama.cpp commands on Windows, Linux and macOS. Model weights, serving binaries, acceleration libraries and stop commands belong to the installation. This plugin does not download models, choose quantization, select GPU layers or modify voice plugins. It does not manage Ollama or vLLM.

## Existing Windows setup

No configuration migration is needed for the original TurboQuant/Qwen installation. Its existing `startScript`, `stopScript`, context lookup, loopback ports, graphs-ON preference and visible console remain the defaults on Windows. The start script receives exactly `-ContextSize <N>` as before. The current provider timeouts are outside this plugin and are unchanged.

The plugin update must be loaded by the DSH host after active work finishes. Changing either launch toggle later saves a volatile setting without remounting the proxy. It does not change an already running backend.

## Another llama.cpp installation

Set `startCommand` to the serving executable, and `startArgs` to an array of literal arguments. No shell parses this array. On Windows, use an executable such as `C:/llama/llama-server.exe`; on Linux/macOS use an installed `llama-server` path. Select acceleration through that binary and its arguments; CUDA, other GPU backends and CPU inference remain llama.cpp's responsibility.

For example, this headless configuration launches a model on any platform after adjusting its file paths:

```yaml
- id: local-model-manager
  config:
    startCommand: /opt/llama.cpp/bin/llama-server
    startArgs:
      - -m
      - '{modelPath}'
      - -c
      - '{contextSize}'
      - --host
      - '{host}'
      - --port
      - '{port}'
      - --alias
      - '{servedModel}'
    modelPath: /models/text-model.gguf
    servedModel: text-model
    defaultModel: text-model
    defaultContextSize: 8192
    openConsole: false
    commandLogPath: /home/me/.dsh/logs/llama-server.log
    stopCommand: /home/me/bin/stop-my-llama-server
    stopArgs: ['{port}']
```

`stopCommand` is an installer-supplied executable or script that stops only this backend. It must accept the arguments you configure and work for a backend adopted after a host restart. The plugin does not invent a shutdown endpoint or issue broad process-name kills. If a custom launcher has no stop command, cold starts and matching-server adoption still work, but a resize/model switch fails before stopping anything. A failing or timed-out stop that leaves the backend online prevents a replacement launch. Windows installers can use `powershell.exe` with `stopArgs: ['-NoProfile', '-File', 'C:/path/to/stop-one-server.ps1']`.

`commandCwd` optionally sets the working directory. `commandEnv` adds or overrides string environment values only for launch/stop children; it is marked secret in the DSH schema. Graph policy then sets or clears `GGML_CUDA_DISABLE_GRAPHS` in the model child as selected by the UI. The Host and voice environments are untouched.

Direct hidden launches write stdout and stderr to `commandLogPath` (default `~/.dsh/logs/llama-server.log`). Set it to an empty string to discard those diagnostics. POSIX direct launches use a separate session and independent file descriptors so closing the manager does not close a backend's diagnostic pipe. The legacy Windows launcher retains its original console/log handling.

## Model dropdown profiles

`modelContexts` maps dropdown ids to context sizes. `modelProfiles` additionally selects weights, a projector or a replacement argument array. Profile `contextSize` wins over `modelContexts`, followed by the first matching `id`/`contextWindow` in `settingsPath`, then `defaultContextSize`. Settings lookup reads YAML/JSON, including quoted ids and YAML aliases. DSH `!!js` expressions remain opaque data and are never executed; use a numeric context or an explicit mapping for computed configurations.

For separate weight files, extend the command example above with:

```yaml
    defaultModel: small
    modelContexts:
      small: 8192
      large: 32768
    modelProfiles:
      small:
        modelPath: /models/small.gguf
      large:
        modelPath: /models/large.gguf
        servedModel: large
      vision:
        modelPath: /models/vision.gguf
        projectorPath: /models/mmproj.gguf
        contextSize: 16384
        servedModel: vision
        startArgs:
          - -m
          - '{modelPath}'
          - -mm
          - '{projectorPath}'
          - -c
          - '{contextSize}'
          - --host
          - '{host}'
          - --port
          - '{port}'
          - --alias
          - '{servedModel}'
```

A profile with a weight path defaults its served alias to its dropdown id, overriding the global alias. Configure the command to advertise that alias, as above. The manager checks `/v1/models` as well as context, so different profiles with equal context still switch their weights. When a served alias is configured, JSON request model fields are forwarded using that alias; legacy context-only requests remain unchanged. `startArgs` in a profile replaces the complete global array. A profile can override `startCommand`; it uses the installation's common stop command. `defaultModel` chooses a profile for requests without a model id, including `/v1/models` discovery. The existing Windows setup needs none of these profiles: its context-only dropdown entries continue using its original fixed weights.

Recognized argument placeholders are `{contextSize}`, `{model}`, `{servedModel}`, `{modelPath}`, `{projectorPath}`, `{host}` and `{port}`. Expansion changes one argument's value, never its argument count. Missing values for recognized placeholders fail before spawning. Other braces remain literal. Windows native quoting preserves spaces, apostrophes, embedded quotes, empty arguments and trailing backslashes.

## Diagnostic windows

The existing Windows script console is unchanged. A custom Windows command uses a visible native console too, with argument data and exit status passed through a separate supervisor. It uses no encoded PowerShell command and changes no execution policy.

On Linux/macOS, a separate window requires an installer-selected terminal adapter. Set `terminalCommand` to that executable and `terminalArgs` to its argv template. The array must contain separate `{command}` and `{args}` entries: the latter expands to multiple literal argv entries. The adapter must preserve the environment and launch the supplied command. Different terminals have different syntax, so the plugin does not guess or install one. If no adapter is configured, choose `openConsole: false` and inspect `commandLogPath`; a request for an unconfigured window fails explicitly before launch.

POSIX installations retaining scripts instead of `startCommand` default to `~/.dsh/local-model/start.sh` and `stop.sh`. They run with `sh`; the starter receives the context as its first positional argument, and the stop script receives none. Supply your own paths or commands rather than expecting the Windows TurboQuant scripts to run there.

## An already managed backend

Set `manageServer: false` to forward through an independently started llama.cpp server. The plugin still checks readiness but never launches, stops or resizes it. A known served-model mismatch is refused. A context mismatch is retained because the external owner controls its allocation. A missing backend returns an error without spawning anything.

For a backend configured with an API key, `targetApiKey` supplies the Bearer key for readiness probes and upstream requests; it is secret in the DSH schema and is not logged. Leave it empty to retain the caller's existing upstream authorization behavior. Configure the backend's key separately.

## Validation limits

Native Windows tests exercise real CPU-only fixture processes for startup, context changes, profile changes, auth, host adoption, legacy PowerShell arguments and native argv quoting. Pure launch-plan tests cover Windows, Linux and macOS. The test suite never loads production weights or allocates model VRAM. The earlier real RTX 5090/Qwen graph results still describe only that installation; different models, GPU backends, operating systems, terminal applications and quantization options need their own hardware validation. The optional model-free CI template has not run for this release; see [CI setup](../ci/README.md). Linux/macOS runtime and GPU validation remain outstanding.
