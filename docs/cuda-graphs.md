# CUDA graph slowdown investigation

Updated 2026-10-10. This records one Windows/RTX 5090 installation, not a general diagnosis for every llama.cpp backend.

## What the option means

The plugin option is **disableCudaGraphs**. Setting it to `true` turns CUDA graph capture/replay OFF for future Qwen starts. Qwen still runs on the GPU. It does not change voice-chat, voice, or CPU/GPU TTS selection.

Setting it to `false` preserves the inherited environment. In the tested backend, the presence of `GGML_CUDA_DISABLE_GRAPHS` disables graphs regardless of its value: even `0` disables them. To test graphs ON, the variable must be absent from the server's launch environment. Changing configuration cannot alter a server already running.

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

## Safe fix and remaining validation

The currently validated mitigation is the plugin's supplied `disableCudaGraphs: true`. It restored long-prompt throughput without changing context, offload, or voice selection. Cancellation forwarding independently fixes abandoned requests occupying the only server slot; the existing 30-minute DSH timeout is separate from both issues.

A permanent graphs-ON fix remains unvalidated. The next diagnostic comparison requires an idle maintenance window:

1. Keep the existing binary, configuration and a reproducible synthetic prompt as the baseline. Use fresh prompts or disable prefix reuse so prompt processing is actually measured.
2. Build a separate candidate directory incorporating the official fixed-workspace patch. Do not overwrite loaded DLLs or the live launcher. Run the source repository's required codec, quantization and backend correctness gates, followed by TurboQuant model benchmarks.
3. Compare stock OFF, stock ON and candidate ON with the same context, weights, projector, batch sizes and voice state. Run 20k, 100k and 150k fresh prefills, then varied repeated requests. Capture per-batch timings and Windows dedicated/shared GPU memory throughout, not just a free-VRAM snapshot.
4. If the candidate still slows, collect a CUDA trace and graph capture/update/eviction counts to distinguish graph overhead, a kernel stall and Windows memory residency. Test smaller context/headroom separately so it cannot confound the patch comparison.
5. Switch the plugin's launcher to the candidate and enable graphs only after correctness and sustained throughput checks pass. Rollback is the original launcher with `disableCudaGraphs: true`.

No GPU benchmark, server restart, driver setting change, DLL replacement or graph setting change was performed during the live investigation. Source applicability is the only completed check on the candidate patch.
