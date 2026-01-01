from typing import Dict, Any

import httpx

from .settings import Settings


NOSANA_API_BASE = "https://api.nosana.io"


def submit_nosana_run(settings: Settings, job_id: str, payload: Dict[str, Any]) -> str:
    # Submit a job run to Nosana and return the run id.
    headers = {
        "Authorization": f"Bearer {settings.NOSANA_API_KEY}",
        "Content-Type": "application/json",
    }
    request_body = {
        "image": settings.NOSANA_WORKER_IMAGE,
        "gpu": settings.NOSANA_GPU_MODEL,
        "env": payload,
    }
    try:
        response = httpx.post(
            f"{NOSANA_API_BASE}/runs",
            json=request_body,
            headers=headers,
            timeout=30.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Nosana submission failed for {job_id}: {exc}") from exc
    data = response.json()
    run_id = data.get("id")
    if not run_id:
        raise RuntimeError(f"Nosana response missing run id for {job_id}")
    return str(run_id)
