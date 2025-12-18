# KangKlip (Early Stage)

KangKlip is an early-stage AI video processing pipeline designed to explore **ephemeral, GPU-heavy workloads** on decentralized GPU infrastructure such as **Nosana**.

The project focuses on running **ASR, LLM-based clip selection, and video rendering** as **stateless Docker jobs**, rather than persistent GPU services.

> ⚠️ This repository is in an **early development phase**.  
> Current contents focus on architecture, execution model, and design decisions.  
> Implementation and benchmarks will be added incrementally.

---

## Project goal

KangKlip aims to turn long-form videos (e.g., podcasts, interviews, lectures) into short-form clips by:

- Transcribing audio (ASR)
- Identifying highlight segments (LLM inference)
- Rendering short clips using GPU-accelerated video processing

The core objective is to validate this workflow as a **realistic, production-style GPU workload** that can run efficiently as **ephemeral jobs**.

---

## Why early-stage?

This project intentionally starts with:

- Clear architectural boundaries
- Minimal assumptions about persistence
- Explicit cost and execution tradeoffs

Rather than optimizing prematurely, the current phase focuses on:
- Job structure
- Data flow
- GPU usage patterns
- Alignment with decentralized schedulers

---

## Design principles

- **Stateless execution**  
  Each video is processed as an isolated job. No persistent GPU workers are assumed.

- **Ephemeral GPU usage**  
  Jobs are expected to start, run, and terminate within a bounded time window.

- **1 job = 1 GPU (initial model)**  
  This simplifies scheduling, cost attribution, and failure isolation during early development.

- **Production-inspired workload**  
  ASR + LLM inference + video rendering reflects real-world GPU usage, not synthetic benchmarks.

---

## Planned pipeline (high-level)

1. **Ingest**
   - Upload or URL-based input (e.g., YouTube)
2. **Preprocessing**
   - Audio extraction, normalization, optional VAD
3. **ASR**
   - Open-source speech-to-text (e.g., faster-whisper)
4. **Clip ranking**
   - LLM-based scoring and segment selection
5. **Rendering**
   - FFmpeg-based clip generation (GPU acceleration when available)
6. **Output**
   - Short clips + metadata stored in object storage

---

## Intended execution environment

- **Worker runtime**: Docker
- **GPU execution**: Nosana decentralized GPU network
- **Storage**: S3-compatible object storage (e.g., Cloudflare R2)
- **API layer**: Lightweight HTTP service (planned)

This repository will eventually include:
- A GPU worker container
- A minimal API for job submission
- Example Nosana job configurations

---

## Current status

- Architecture and execution model defined
- Early design validated against Nosana’s job-based GPU model
- Implementation and benchmarking **in progress**

No production guarantees are made at this stage.

---

## Roadmap (non-binding)

- [ ] Minimal worker Docker image
- [ ] End-to-end prototype: ASR → clip selection → rendering
- [ ] Example Nosana job configuration
- [ ] Basic benchmarking on different GPU tiers
- [ ] Iteration on batching and cost optimizations

---

## Repository structure (planned)

```text
kangklip/
├── backend/     # API and orchestration (planned)
├── worker/      # GPU worker container (planned)
├── docs/        # Architecture and Nosana-specific docs
└── README.md
