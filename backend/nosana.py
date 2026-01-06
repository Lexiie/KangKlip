from typing import Dict, Any

import httpx

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
        "timeout": 7200,
        "replicas": 1,
        "strategy": "SIMPLE",
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
        raise RuntimeError(f"Nosana deployment create failed for {job_id}: {exc}") from exc
    data = response.json()
    deployment_id = data.get("id") or data.get("deployment_id")
    if not deployment_id:
        raise RuntimeError(f"Nosana response missing deployment id for {job_id}")
    try:
        start_response = httpx.post(
            f"{settings.NOSANA_API_BASE}/deployments/{deployment_id}/start",
            headers=headers,
            timeout=30.0,
        )
        start_response.raise_for_status()
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Nosana deployment start failed for {job_id}: {exc}") from exc
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
