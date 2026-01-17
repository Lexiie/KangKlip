from pathlib import Path
from typing import Dict, List

import boto3
import httpx
import orjson
from botocore.config import Config


def upload_to_r2(
    r2_endpoint: str,
    r2_bucket: str,
    access_key: str,
    secret_key: str,
    prefix: str,
    artifacts: List[Path],
    clips: List[Path],
    manifest: Dict[str, object],
) -> None:
    # Upload artifacts and clips to R2 with deterministic paths.
    client = boto3.client(
        "s3",
        endpoint_url=r2_endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    manifest_key = f"{prefix.rstrip('/')}/manifest.json"
    client.put_object(Bucket=r2_bucket, Key=manifest_key, Body=orjson.dumps(manifest))
    for artifact in artifacts:
        key = f"{prefix.rstrip('/')}/{artifact.name}"
        client.upload_file(str(artifact), r2_bucket, key)
    for clip in clips:
        key = f"{prefix.rstrip('/')}/{clip.name}"
        client.upload_file(str(clip), r2_bucket, key)
        # Verify the clip exists in storage.
        client.head_object(Bucket=r2_bucket, Key=key)


def callback_backend(callback_url: str, payload: Dict[str, object], token: str | None = None) -> None:
    # Notify backend about job completion.
    headers = {}
    if token:
        headers["x-callback-token"] = token
    try:
        response = httpx.post(callback_url, json=payload, headers=headers, timeout=15.0)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Callback failed: {exc}") from exc


def upload_error(
    r2_endpoint: str,
    r2_bucket: str,
    access_key: str,
    secret_key: str,
    prefix: str,
    error_payload: Dict[str, object],
) -> None:
    # Upload error payload to R2 for failed jobs.
    client = boto3.client(
        "s3",
        endpoint_url=r2_endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    key = f"{prefix.rstrip('/')}/error.json"
    client.put_object(Bucket=r2_bucket, Key=key, Body=orjson.dumps(error_payload))
