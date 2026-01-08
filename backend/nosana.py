from typing import Dict, Any

import httpx
import threading
import time

from .settings import Settings


def submit_nosana_run(settings: Settings, job_id: str, payload: Dict[str, Any]) -> str:
    # Submit a deployment to Nosana and return the deployment id.
    headers = {
        "Authorization": f"Bearer {settings.NOSANA_API_KEY}",
        "Content-Type": "application/json",
    }
    request_body = {
        "name": job_id,
        "market": settings.NOSANA_MARKET,
        "timeout": 60,
        "replicas": 1,
        "strategy": "SIMPLE",
        "confidential": False,
        "job_definition": {
            "version": "0.1",
            "type": "container",
            "meta": {"trigger": "api"},
            "ops": [
                {
                    "id": "worker",
                    "type": "container/run",
                    "args": {
                        "image": settings.NOSANA_WORKER_IMAGE,
                        "gpu": True,
                    },
                }
            ],
            "global": {
                "image": settings.NOSANA_WORKER_IMAGE,
                "gpu": True,
                "env": payload,
            },
        },
    }
    try:
        response = httpx.post(
            f"{settings.NOSANA_API_BASE}/deployments/create",
            json=request_body,
            headers=headers,
            timeout=30.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        detail = ""
        if hasattr(exc, "response") and exc.response is not None:
            try:
                detail = exc.response.text
            except Exception:
                detail = ""
        raise RuntimeError(f"Nosana deployment create failed for {job_id}: {exc} {detail}") from exc
    data = response.json()
    deployment_id = data.get("id") or data.get("deployment_id")
    if not deployment_id:
        raise RuntimeError(f"Nosana response missing deployment id for {job_id}")
    def _attempt_start(retries: int, delay: float) -> None:
        # Retry deployment start in the background.
        for attempt in range(retries):
            try:
                start_response = httpx.post(
                    f"{settings.NOSANA_API_BASE}/deployments/{deployment_id}/start",
                    headers=headers,
                    timeout=30.0,
                )
                start_response.raise_for_status()
                return
            except httpx.HTTPError:
                time.sleep(delay * (attempt + 1))

    start_error: Exception | None = None
    time.sleep(20.0)
    for attempt in range(5):
        try:
            start_response = httpx.post(
                f"{settings.NOSANA_API_BASE}/deployments/{deployment_id}/start",
                headers=headers,
                timeout=30.0,
            )
            start_response.raise_for_status()
            start_error = None
            break
        except httpx.HTTPError as exc:
            start_error = exc
            time.sleep(2.0 * (attempt + 1))
    if start_error:
        thread = threading.Thread(target=_attempt_start, args=(6, 10.0), daemon=True)
        thread.start()
    return str(deployment_id)


def check_market_cache(settings: Settings, image: str) -> Dict[str, Any]:
    # Check whether the worker image is listed in market required resources.
    headers = {
        "Authorization": f"Bearer {settings.NOSANA_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        response = httpx.get(
            f"{settings.NOSANA_API_BASE}/markets/{settings.NOSANA_MARKET}/required-resources",
            headers=headers,
            timeout=15.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Nosana market resource check failed: {exc}") from exc
    data = response.json()
    resources = data.get("resources", []) if isinstance(data, dict) else []
    cached = any(resource.get("name") == image for resource in resources if isinstance(resource, dict))
    return {"cached": cached, "resources": resources}
