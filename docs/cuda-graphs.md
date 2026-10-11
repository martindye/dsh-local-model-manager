# CUDA graph slowdown investigation

Updated 2026-10-11. This records one Windows/RTX 5090 installation, not a general diagnosis for every llama.cpp backend.

## Resolution: graphs ON working on the tested setup

**The reported CUDA graphs slowdown was resolved for the validated Windows/Qwen configuration.** The unchanged backend completed fresh near-full 225k and 350k context tests with graphs ON. The earlier 16–22-second batch stalls did not recur, and the test logs contained no CUDA/cuBLAS errors. Graphs remain enabled by default.

The model manager removes an inherited `GGML_CUDA_DISABLE_GRAPHS` flag when graphs are enabled. The plugin highlights this resolution beside its graph toggle and in the README. No CUDA backend patch was required; the successful configuration does not establish a single root cause or a universal backend fix. The evidence and remaining investigation below distinguish the deployed launcher behaviour from unbuilt upstream candidates.

## What the option means

The plugin option is **disableCudaGraphs**. Setting it to `true` turns CUDA graph capture/replay OFF for future Qwen starts. Qwen still runs on the GPU. It does not change voice-chat, voice, or CPU/GPU TTS selection.

From plugin 0.1.3, setting it to `false` removes `GGML_CUDA_DISABLE_GRAPHS` from the future model child's environment. Earlier versions preserved an inherited value. In the tested backend, the presence of that variable disables graphs regardless of its value: even `0` disables them. The plugin's UI presents the positive **Enable CUDA graphs** switch, ON by default, and saves the inverse `disableCudaGraphs` value. Neither UI changes nor environment changes alter or restart a server already running.

Two log messages are easy to misread:

- `graphs reused` is llama.cpp's CPU-side computation-graph reuse counter, not a CUDA replay counter. It can increase with CUDA graphs disabled.
- `USE_GRAPHS = 1` reports compiled support, not whether the running process has disabled graphs through its environment.

## Local evidence

Configuration: TurboQuant source/build `f6124e914f60a414a13dbf6d878ff107ac6432fb`, Qwen3.8-27B Q6_K_L with vision projector, RTX 5090, NVIDIA driver 616.92, CUDA 12.8, 225024 actual context, batch 512, microbatch 256, one slot, turbo2 K/V, flash attention on.

Earlier controlled runs retained the same GPU voice process in both conditions. That removes unloading voice as the explanation for this comparison. The later normal session uses CPU voice-chat.

| Condition | Observation |
| --- | --- |
| CUDA graphs ON, 20k prompt | 2420.83 prompt tokens/s. |
| CUDA graphs ON, 100k prompt | Initially about 2400 tokens/s. At 34816 -> 35328 tokens, a 512-token batch took 16.94 seconds; subsequent batches took roughly 16-22 seconds. The request was cancelled before completion. |
| CUDA graphs OFF, 20k prompt | 2396.26 prompt tokens/s. |
| CUDA graphs OFF, 100k prompt | 59955.36 ms / 100004 tokens = 1667.97 tokens/s. |
| CUDA graphs OFF, 150k prompt | 110274.40 ms / 150007 tokens = 1360.31 tokens/s; generation 26.94 tokens/s. |

These are log measurements, not a complete hardware/build compatibility test. They establish the graph-enabled path as a reproducible trigger in this setup, but do not identify a particular faulty kernel or prove a driver defect.

During the subsequent read-only inspection, the original server continued serving the user's work. One snapshot showed 2334 MiB free VRAM, 86% GPU utilization and 473 W power; Windows reported approximately 26846 MiB dedicated and 198 MiB shared GPU memory for the server. This snapshot describes the healthy graphs-OFF process. It cannot establish memory residency during the earlier slow run.

No Display/nvlddmkm events were returned from the Windows System event log for the inspected period beginning at noon. The observed failure was persistent slow processing, rather than a documented driver reset.

## Source and upstream findings

The pinned source already contains the [graph warm-up change](https://github.com/ggml-org/llama.cpp/pull/19754). Its CUDA graph map evicts entries idle for at least ten seconds, sweeping every five seconds. Calling this an unbounded permanent cache leak without instrumentation would be premature.

The source does not contain the later [fixed cuBLAS workspace change, PR 26574](https://github.com/ggml-org/llama.cpp/pull/26574), merged on 2026-08-20. The official patch passes `git apply --check` against the exact pinned source without modifying it. It assigns a persistent workspace and handle per stream, replacing repeated workspace-resetting `cublasSetStream` calls. This is a candidate for a separately built comparison, not a validated fix for this installation.

That PR's confirmed allocation-reclamation bug concerned cuBLAS versions older than 12.4. The running server actually loads cuBLAS and cudart from CUDA 12.8. Therefore the missing patch alone does **not** establish that the older cuBLAS bug explains this slowdown. [NVIDIA documents cuBLAS graph/workspace behavior](https://docs.nvidia.com/cuda/cublas/index.html#cuda-graphs-support), but its documented behavior does not prove this machine's failure mechanism.

[Upstream issue 27330](https://github.com/ggml-org/llama.cpp/issues/27330) remains open and reports Qwen3.8/Blackwell graph-related hangs, including a Windows RTX 5090 report using driver 616.92. Disabling CUDA graphs helps several reported configurations. Those hangs are relevant leads, not proof that this non-crashing slowdown is the same defect. Reports also include failures with substantial free VRAM, so low headroom is not a universal explanation.

The [legacy-pool recapture proposal, PR 26771](https://github.com/ggml-org/llama.cpp/pull/26771), concerns freed pointers in the legacy allocator. This installation is built with VMM enabled; applying that patch as the explanation would be unsupported.

## Maintenance validation

The user's active turn ended before maintenance began. The production executable and CUDA DLLs were preserved. No CUDA source patch, driver setting or model quantization change was needed for the graphs-ON tests below.

No other GPU model was resident during these stress tests. Other applications were closed before the 350k tests. These conditions matter when interpreting the available VRAM and applying the results to another installation.

These are fresh synthetic repeated-token prefills, with `cache_prompt: false`, greedy generation and 128 requested output tokens. Every completed case processed the full requested prompt with `cache_n: 0` and generated all 128 tokens. The vision projector was loaded, but these requests did not encode images. The backend, weights, turbo2 K/V, batch 512, microbatch 256 and full GPU offload were retained. At 350k the existing launcher's YaRN scaling applies because this exceeds the model's 262144-token native context.

| Requested context (actual) | CUDA graphs | Fresh prompt tokens | Prefill seconds | Prompt tokens/s | Generation tokens/s |
| --- | --- | --- | --- | --- | --- |
| 225000 (225024) | ON | 20000 | 8.15 | 2453.49 | 46.99 |
| 225000 (225024) | ON | 100000 | 59.18 | 1689.84 | 34.87 |
| 225000 (225024) | ON | 150000 | 110.24 | 1360.65 | 30.11 |
| 225000 (225024) | ON | 224000 | 210.01 | 1066.62 | 24.35 |
| 225000 (225024) | OFF | 20000 | 7.86 | 2544.92 | 40.12 |
| 225000 (225024) | OFF | 224000 | 206.66 | 1083.92 | 22.21 |
| 350000 (350208) | ON | 20000 | 8.10 | 2469.45 | 47.63 |
| 350000 (350208) | ON | 224000 | 208.12 | 1076.32 | 25.11 |
| 350000 (350208) | ON | 348000 | 437.56 | 795.32 | 19.44 |
| 350000 (350208) | OFF | 20000 | 8.05 | 2485.31 | 38.97 |
| 350000 (350208) | OFF | 348000 | 433.79 | 802.23 | 18.29 |

For the near-full 350k comparison, graphs-ON prefill was 0.87% slower and generation was 6.30% faster in this single pair of runs. Both completed normally. This is not a statistical performance guarantee. The ON sequence was 20k, 224k, 348k; the OFF sequence was 20k, 348k, so their preceding allocation histories differ. Every measured prompt still required a fresh full prefill.

At 225k, graphs-ON near-full prefill was 1.62% slower and generation was 9.66% faster in the single comparison. The ON server also handled earlier 100k and 150k requests; the OFF sequence was 20k then 224k. Applications were closed between the early ON tests and the OFF comparisons. These differences limit causal interpretation of small timing changes. [Machine-readable synthetic results](cuda-graph-validation.json) retain all twelve completed stress cases and the exact configuration.

Debug logs recorded `CUDA graph warmup complete`, confirming runtime graph activity rather than relying on the CPU `graphs reused` counter. After the 348k graphs-ON run, another fresh 20k prompt on the same process ran at 2558.90 prompt tokens/s and 46.47 generation tokens/s: the process did not remain slow after the large request.

At 225k, the near-full run's worst recorded 512-token prefill batch took 0.85 seconds; at 350k, the 348k run's worst took 1.16 seconds. The earlier 16-22-second batches did not recur. No CUDA/cuBLAS error lines were found in these test logs.

The 350k run loaded all 66/66 model layers on GPU. Its initial free VRAM was about 1.4 GiB, but minimum sampled free VRAM during the stress sequence was only **201 MiB**. Windows shared usage for the server stayed at 260 MiB throughout, rather than growing during the request. The 225k near-full run's shared usage stayed at 198 MiB. A loaded-server snapshot therefore does not establish full-prompt headroom. The 350k result is specific to the available VRAM during this test and does not establish that it will tolerate additional GPU workloads.

The unchanged backend also passed `test-turbo-quant`, `test-quantize-fns`, the full CPU sweep (25979/25979 executed cases), the full CUDA0 sweep (21446/21446 executed cases), and a real-model turbo2 `llama-bench` smoke run. Unsupported cases were skipped and are not counted as tested coverage.

These observations show that graphs ON works in the tested CPU-voice configuration. They are consistent with memory headroom contributing to the earlier failure; they do not prove that a particular cuBLAS defect or GPU voice alone caused it. The earlier comparison with the same GPU voice present in both modes still establishes graphs ON as the trigger in that configuration. Semantic long-context accuracy and image-input stress are not measured by the repeated-token benchmark.

## Operating choices and remaining investigation

Plugin 0.1.3 enables graphs in the supplied bundle (`disableCudaGraphs: false`) and provides live UI controls for graphs and console visibility. The earlier `true` mitigation remains available if the stall recurs; it restored long-prompt throughput without changing context, offload, or voice selection. The tested local installation uses graphs ON, CPU voice selected, and the original backend. After maintenance, the model manager restored the normal 225000 requested context (225024 actual) and launched the diagnostic console visibly. Model stress tests have stopped and the maintenance lock has been removed. The 0.2.0 portable-launch update retains these defaults and adds no CUDA backend changes or new model stress tests.

Cancellation forwarding independently fixes abandoned requests occupying the only server slot. Both existing DSH provider idle timeouts remain 1800000 ms (30 minutes); they are separate from graph capture and TTS selection. Console visibility remains an independent plugin option, enabled by default.

The fixed-workspace upstream patch remains an unbuilt candidate, not a deployed fix. If the stall recurs with sufficient headroom and CPU voice selected, the next comparison requires an idle maintenance window:

1. Keep the existing binary, configuration and a reproducible synthetic prompt as the baseline. Use fresh prompts or disable prefix reuse so prompt processing is actually measured.
2. Build a separate candidate directory incorporating the official fixed-workspace patch. Do not overwrite loaded DLLs or the live launcher. Run the source repository's required codec, quantization and backend correctness gates, followed by TurboQuant model benchmarks.
3. Compare stock OFF, stock ON and candidate ON with the same context, weights, projector, batch sizes and voice state. Run 20k, 100k and 150k fresh prefills, then varied repeated requests. Capture per-batch timings and Windows dedicated/shared GPU memory throughout, not just a free-VRAM snapshot.
4. If the candidate still slows, collect a CUDA trace and graph capture/update/eviction counts to distinguish graph overhead, a kernel stall and Windows memory residency. Test smaller context/headroom separately so it cannot confound the patch comparison.
5. Switch the plugin's launcher to the candidate and enable graphs only after correctness and sustained throughput checks pass. Rollback is the original launcher with `disableCudaGraphs: true`.

No restart or benchmark was performed while the user's turn was active. Maintenance benchmarks and controlled test-server restarts occurred only after it finished. Source applicability remains the only completed check on the candidate cuBLAS patch; no production DLL was replaced.
