# Practical Trade-Offs of Local LLM Inference

When running Large Language Models (LLMs) locally (e.g., using Ollama, llama.cpp, or Hugging Face Transformers), performance is governed by strict hardware limitations. This document explains the core metrics measured by our benchmarking suite and outlines the critical trade-offs and bottlenecks encountered during local execution.

---

## 1. Key Performance Metrics

Our implementation tracks three critical metrics for each assistant turn:

1. **Time to First Token (TTFT)**
   * **Definition**: The duration between sending a prompt and receiving the first generated token.
   * **Governing Phase**: *Prefill Phase*. The model processes the entire prompt in parallel.
   * **Hardware Bound**: Highly compute-bound (GPU cores / CPU threads). TTFT scales with prompt length (context window size).

2. **Tokens Per Second (Token Throughput)**
   * **Definition**: The rate at which the model generates subsequent tokens after the first.
   * **Governing Phase**: *Decoding Phase*. The model generates tokens autoregressively (one-by-one).
   * **Hardware Bound**: Highly memory bandwidth-bound. The entire model weight set must be read from memory to compute a single token.

3. **Total Response Latency**
   * **Definition**: The total end-to-end time for the entire request.
   * **Formula**: \(\text{Latency} = \text{TTFT} + \left( \frac{\text{Total Tokens}}{\text{Tokens/Sec}} \right)\).
   * **Governing Factor**: Combines both prefill speed, token throughput, and response length.

---

## 2. Hardware Bottlenecks: Memory Bandwidth vs. Compute

The execution of LLMs is divided into two distinct computational profiles:

### Prefill Phase (Batch Processing)
* When ingestion occurs, matrix operations can be batched, making it highly **compute-bound**. 
* High-core-count GPUs or CPUs with high FLOPS excel here, resulting in a low TTFT.

### Decoding Phase (Autoregressive Generation)
* For every single token generated, the model must read all its parameters from memory to the processor.
* For a 7B parameter model at FP16, this requires reading ~14 GB of data per token.
* **The memory bandwidth bottleneck**: Generation speed is directly limited by how fast the hardware can stream weights from RAM/VRAM to the processor.
  $$\text{Tokens/Sec (Theoretical Max)} \approx \frac{\text{Memory Bandwidth (GB/s)}}{\text{Model Size (GB)}}$$

---

## 3. GPU vs. CPU Performance Comparison

The table below highlights typical generation throughputs based on hardware class and memory type:

| Hardware Configuration | Typical Memory Bandwidth | 8B Model Size (4-bit / 4.8GB) | 8B Model Size (8-bit / 8.5GB) |
| :--- | :--- | :--- | :--- |
| **System RAM (DDR4 Dual Channel)** | ~40-50 GB/s | ~8 - 10 tok/s | ~4 - 5 tok/s |
| **System RAM (DDR5 Dual Channel)** | ~60-80 GB/s | ~12 - 16 tok/s | ~7 - 9 tok/s |
| **Apple Silicon (M-Series Unified)** | ~100-800 GB/s | ~20 - 150 tok/s | ~11 - 90 tok/s |
| **Consumer GPU (e.g., RTX 4070 VRAM)** | ~500 GB/s | ~100+ tok/s | ~55 tok/s |
| **Enterprise GPU (e.g., NVIDIA A100)** | ~2,000 GB/s | ~400+ tok/s | ~230 tok/s |

> [!IMPORTANT]
> If a model exceeds the available GPU VRAM, it must be "offloaded" partially or fully to system RAM. This causes an immediate, massive drop in generation throughput (often by 90% or more) as it becomes bottlenecked by PCIe bus speeds and system RAM bandwidth.

---

## 4. Model Quantization Trade-offs

Quantization is the process of compressing model weights from high precision (e.g., FP16 or FP32) to lower-bit representations (e.g., 8-bit, 4-bit, or 2-bit integers).

### Advantages
1. **Lower VRAM Footprint**: Reduces memory size, allowing larger models (e.g., 8B or 13B parameters) to fit entirely in consumer VRAM (e.g., 8GB-12GB).
2. **Higher Throughput**: Smaller size means less data needs to be read from memory per token, increasing tokens/sec.

### Disadvantages
1. **Perplexity Loss**: Lower precision introduces quantization noise, reducing the accuracy, reasoning capability, and coherence of the model.
2. **Quality Degradation**:
   * **Q8_0 (8-bit)**: Minimal quality loss; near indistinguishable from FP16.
   * **Q4_K_M (4-bit)**: The "sweet spot" for most consumer hardware, offering a great balance of size and response quality.
   * **Q2_K (2-bit)**: Significant coherence loss; models tend to hallucinate or break syntax frequently.

---

## 5. Local vs. Cloud-Based API Trade-offs

Choosing local LLM inference over cloud API services (like OpenAI, Claude, or Gemini) involves several key trade-offs:

| Attribute | Local Inference (Ollama/llama.cpp) | Cloud API Services (OpenAI/Anthropic) |
| :--- | :--- | :--- |
| **Data Privacy** | **Absolute**: Data never leaves the host machine. | **Conditional**: Subject to terms of service and compliance audits. |
| **Operating Cost** | **Zero per-token**: Only pay for electricity. | **Pay-per-use**: Costs scale with prompt and completion size. |
| **Upfront Cost** | **High**: Requires modern GPU / hardware. | **Zero**: No specialized hardware required. |
| **Throughput** | Bound by local hardware bandwidth. | Scaled dynamically via cloud provider clusters. |
| **Availability** | **Offline**: Works without internet connection. | Requires persistent high-speed internet. |
| **Model Size** | Limited by local VRAM (typically \(\le 32\text{B}\)). | Access to massive frontier models (e.g., \(> 1\text{T}\) parameters). |
