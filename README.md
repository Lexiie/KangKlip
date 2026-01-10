# KangKlip

![Backend](https://img.shields.io/badge/Backend-Express%20%2B%20TypeScript-2f74c0)
![Frontend](https://img.shields.io/badge/Frontend-Next.js-000000)
![Worker](https://img.shields.io/badge/Worker-Python-3776ab)
![GPU](https://img.shields.io/badge/GPU-NVIDIA%20RTX%203080-76b900)
![Nosana](https://img.shields.io/badge/Compute-Nosana-3a72ff)
![Storage](https://img.shields.io/badge/Storage-Cloudflare%20R2-f38020)
![Queue](https://img.shields.io/badge/State-Redis-dc382d)

KangKlip is a deterministic, GPU-first short‑clip generator. Paste a long‑form video URL and get 1–5 vertical clips (30/45/60s) with titles and download links. The system is designed for speed and repeatability: the same input yields the same segments, the same render boundaries, and the same artifacts in storage.

## Table of Contents

- [Why It Stands Out](#why-it-stands-out)
- [Quick Start](#quick-start)
- [Services](#services)
- [Architecture at a Glance](#architecture-at-a-glance)
- [End-to-End Workflow](#end-to-end-workflow)
- [API Surface](#api-surface)
- [Storage Layout (R2)](#storage-layout-r2)
- [Job State Lifecycle](#job-state-lifecycle)
- [Backend](#backend)
- [Worker](#worker)
- [Demo Workflow (Local)](#demo-workflow-local)
- [Production Notes](#production-notes)
- [Troubleshooting](#troubleshooting)
- [Definition of Done](#definition-of-done)
- [Frontend](#frontend)

## Why It Stands Out

- **Script‑driven, not linear.** The pipeline selects highlight segments from a transcript rather than trimming the first N minutes.
- **Deterministic job model.** Every job is stateless, runs on exactly one GPU, and writes to a fixed R2 prefix.
- **Speed‑first architecture.** Fast transcript resolution (prefer existing captions, fallback ASR), vLLM selection, and FFmpeg render.
- **Clean artifact trail.** Manifest + transcript + chunks + EDL are uploaded alongside clips for auditability.

## Services

- `backend/` Express + TypeScript orchestrator
- `worker/` GPU pipeline job
- `frontend/` Next.js UI

## Architecture at a Glance

```
User → Frontend → Backend (Express) → Nosana GPU Job → R2
                      ↑                 ↓
                  Redis state      Callback status
```

## End-to-End Workflow

1. **User submits** a URL, duration (30/45/60), count (1–5), and language.
2. **Backend validates** input, generates `kk_<ULID>`, stores job state in Redis, and submits a Nosana run.
3. **Worker pipeline** executes:
   - Download video → extract audio
   - Transcript resolution (prefer captions; fallback ASR)
   - Chunking (10–20s segments)
   - LLM selection (Qwen2.5‑3B via vLLM)
   - FFmpeg render to 9:16
   - Upload artifacts + clips to R2
4. **Worker callback** marks job `SUCCEEDED` or `FAILED`.
5. **Frontend polls** status and lists signed download URLs.

## API Surface

- `POST /api/jobs` → create a job, returns `{ job_id, status }`
- `GET /api/jobs/{job_id}` → status + stage + progress
- `GET /api/jobs/{job_id}/results` → clip titles + signed URLs
- `POST /api/callback/nosana` → worker completion/failure (demo‑mode, no auth)

## Storage Layout (R2)

```
jobs/{job_id}/
  manifest.json
  transcript.json
  chunks.json
  edl.json
  source_meta.json
  clip_01.mp4
  clip_02.mp4
```

## Job State Lifecycle

- `QUEUED` → created and awaiting GPU
- `RUNNING` → worker stages (DOWNLOAD, TRANSCRIPT, CHUNK, SELECT, RENDER, UPLOAD)
- `SUCCEEDED` → artifacts uploaded, results available
- `FAILED` → error captured in job state

## Backend

Run locally:

```bash
cd backend
npm install
npm run dev
```

Required environment variables (no placeholders):

- `NOSANA_API_BASE`
- `NOSANA_API_KEY`
- `NOSANA_WORKER_IMAGE`
- `NOSANA_MARKET`
- `NOSANA_GPU_MODEL`
- `REDIS_URL`
- `R2_ENDPOINT`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `CALLBACK_BASE_URL`
- `LLM_API_BASE`
- `LLM_MODEL_NAME`

## Worker

Run in container with GPU and bundled deps. The entrypoint is `worker/main.py`.

Build image:

```bash
cd worker
docker build \
  -t kangklip-worker:latest .
```

Required environment variables:

- `JOB_ID`
- `VIDEO_URL`
- `CLIP_COUNT`
- `MIN_CLIP_SECONDS`
- `MAX_CLIP_SECONDS`
- `OUTPUT_LANGUAGE`
- `R2_ENDPOINT`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PREFIX`
- `CALLBACK_URL`

Optional overrides (defaults are optimized for RTX 3080):

- `LLM_API_KEY`
- `LLM_TIMEOUT_SECONDS`

## Demo Workflow (Local)

1. Start Redis.
2. Run the backend (`npm run dev`).
3. Run the frontend (`NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev`).
4. Submit a job and watch progress in `/jobs/{job_id}`.

## Production Notes

## Quick Start

```bash
# 1) Configure env
cp .env.example .env
# fill in required variables

# 2) Start Redis (if not already running)
redis-server --daemonize yes

# 3) Run backend
cd backend
npm install
npm run dev

# 4) Run frontend
cd ../frontend
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```

## Troubleshooting

- **Job stuck in QUEUED**: check Nosana deployment status and whether `start_error` is set in `/api/jobs/{id}`.
- **Job RUNNING but no results**: verify callback URL is correct and reachable from Nosana.
- **No dashboard logs**: ensure worker writes to stdout/stderr (see `worker/main.py` logging).
- **YouTube transcript empty**: video may have no captions; ASR fallback will be used.

- Callback auth is intentionally skipped for demo speed; add HMAC/signature checks in production.
- The worker image is expected to include all model weights and dependencies (no runtime installs).
- The GPU model is locked to RTX 3080 per PRD.

## Definition of Done

- URL → clips generated successfully
- Artifacts stored in R2
- Backend reports correct state
- Frontend can download outputs
- No GPU OOM on RTX 3080

## Frontend

Run locally:

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```
