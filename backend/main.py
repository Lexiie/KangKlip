from typing import Dict, Any
import re

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import ulid

from .models import (
    JobCreateRequest,
    JobCreateResponse,
    JobStatusResponse,
    JobResultsResponse,
    JobStatus,
    JobStage,
    CallbackRequest,
    ClipResult,
)
from .nosana import submit_nosana_run, check_market_cache
from .r2 import load_manifest, sign_clip_urls
from .settings import get_settings
from .storage import JobStore

app = FastAPI(title="KangKlip API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _build_job_id() -> str:
    # Build a deterministic job id using ULID.
    return f"kk_{ulid.new().str}"


def _build_callback_url(base_url: str) -> str:
    # Build the worker callback URL from the base URL.
    return f"{base_url.rstrip('/')}/api/callback/nosana"


def _build_worker_env(settings, job_id: str, payload: JobCreateRequest, callback_url: str) -> Dict[str, Any]:
    # Construct environment variables to pass into the worker job.
    clip_seconds = str(payload.clip_duration_seconds)
    env = {
        "JOB_ID": job_id,
        "VIDEO_URL": str(payload.video_url),
        "CLIP_COUNT": str(payload.clip_count),
        "MIN_CLIP_SECONDS": clip_seconds,
        "MAX_CLIP_SECONDS": clip_seconds,
        "OUTPUT_LANGUAGE": payload.language,
        "TRANSCRIPT_MODE": "prefer_existing",
        "ASR_FALLBACK": "true",
        "ASR_MODEL": "base",
        "R2_ENDPOINT": settings.R2_ENDPOINT,
        "R2_BUCKET": settings.R2_BUCKET,
        "R2_ACCESS_KEY_ID": settings.R2_ACCESS_KEY_ID,
        "R2_SECRET_ACCESS_KEY": settings.R2_SECRET_ACCESS_KEY,
        "LLM_API_BASE": settings.LLM_API_BASE,
        "LLM_TIMEOUT_SECONDS": str(settings.LLM_TIMEOUT_SECONDS),
        "LLM_MODEL_NAME": settings.LLM_MODEL_NAME,
        "CALLBACK_URL": callback_url,
        "R2_PREFIX": f"jobs/{job_id}/",
    }
    if settings.LLM_API_KEY:
        env["LLM_API_KEY"] = settings.LLM_API_KEY
    return env


def _get_store() -> JobStore:
    # Initialize JobStore for each request.
    settings = get_settings()
    return JobStore(settings.REDIS_URL)


@app.post("/api/jobs", response_model=JobCreateResponse)
def create_job(payload: JobCreateRequest) -> JobCreateResponse:
    # Create a job entry, submit to Nosana, and return the job id.
    settings = get_settings()
    store = JobStore(settings.REDIS_URL)
    job_id = _build_job_id()
    callback_url = _build_callback_url(settings.CALLBACK_BASE_URL)
    worker_env = _build_worker_env(settings, job_id, payload, callback_url)
    store.set(
        job_id,
        {
            "job_id": job_id,
            "status": JobStatus.QUEUED.value,
            "stage": JobStage.DOWNLOAD.value,
            "progress": 0,
        },
    )
    try:
        cache_info = check_market_cache(settings, settings.NOSANA_WORKER_IMAGE)
        store.update(job_id, {"market_cache": cache_info})
    except Exception:
        pass
    try:
        run_id = submit_nosana_run(settings, job_id, worker_env)
    except Exception as exc:
        store.update(job_id, {"status": JobStatus.FAILED.value, "error": str(exc)})
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    store.update(job_id, {"nosana_run_id": run_id})
    return JobCreateResponse(job_id=job_id, status=JobStatus.QUEUED)


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    # Fetch job status and progress.
    store = _get_store()
    data = store.get(job_id)
    if not data:
        raise HTTPException(status_code=404, detail="job not found")
    return JobStatusResponse(
        job_id=job_id,
        status=JobStatus(data.get("status", JobStatus.QUEUED.value)),
        stage=JobStage(data.get("stage")) if data.get("stage") else None,
        progress=data.get("progress"),
    )


@app.get("/api/jobs/{job_id}/results", response_model=JobResultsResponse)
def get_results(job_id: str) -> JobResultsResponse:
    # Retrieve job outputs from R2 and return signed URLs.
    settings = get_settings()
    store = JobStore(settings.REDIS_URL)
    data = store.get(job_id)
    if not data:
        raise HTTPException(status_code=404, detail="job not found")
    if data.get("status") != JobStatus.SUCCEEDED.value:
        raise HTTPException(status_code=409, detail="job not completed")
    r2_prefix = data.get("r2_prefix")
    if not r2_prefix:
        raise HTTPException(status_code=500, detail="missing r2 prefix")
    try:
        manifest = load_manifest(settings, r2_prefix)
        clips = manifest.get("clips", [])
        clip_files = [clip["file"] for clip in clips]
        urls = sign_clip_urls(settings, r2_prefix, clip_files)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    results = []
    for clip, url in zip(clips, urls, strict=False):
        results.append(
            ClipResult(
                title=clip.get("title", ""),
                duration=int(clip.get("duration", 0)),
                download_url=url,
            )
        )
    return JobResultsResponse(clips=results)


@app.post("/api/callback/nosana")
def nosana_callback(payload: CallbackRequest) -> JSONResponse:
    # Update job state after worker callback.
    # TODO: Require auth/signature for production deployments.
    store = _get_store()
    if not _is_valid_job_id(payload.job_id):
        raise HTTPException(status_code=400, detail="invalid job id")
    data = store.get(payload.job_id)
    if not data:
        raise HTTPException(status_code=404, detail="job not found")
    updates = {
        "status": payload.status.value,
        "r2_prefix": payload.r2_prefix,
        "error": payload.error,
        "stage": JobStage.DONE.value,
        "progress": 100,
    }
    store.update(payload.job_id, updates)
    return JSONResponse({"ok": True})
def _is_valid_job_id(job_id: str) -> bool:
    # Validate job id format (kk_ + ULID).
    return bool(re.match(r"^kk_[0-9A-HJKMNP-TV-Z]{26}$", job_id))
