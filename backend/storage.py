import json
from typing import Any, Dict, Optional

import redis


class JobStore:
    # Provide Redis-backed persistence for job state.
    def __init__(self, redis_url: str) -> None:
        # Initialize Redis client with a URL.
        self._client = redis.Redis.from_url(redis_url, decode_responses=True)

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        # Fetch job state from Redis.
        raw = self._client.get(job_id)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    def set(self, job_id: str, payload: Dict[str, Any]) -> None:
        # Persist job state to Redis.
        self._client.set(job_id, json.dumps(payload))

    def update(self, job_id: str, updates: Dict[str, Any]) -> None:
        # Merge updates into existing job state.
        current = self.get(job_id) or {}
        current.update(updates)
        self.set(job_id, current)
