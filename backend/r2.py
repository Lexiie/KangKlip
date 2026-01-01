import json
from typing import Any, Dict, List

import boto3
from botocore.config import Config

from .settings import Settings


def _get_r2_client(settings: Settings):
    # Build a boto3 client for Cloudflare R2.
    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def load_manifest(settings: Settings, prefix: str) -> Dict[str, Any]:
    # Download and parse the job manifest from R2.
    client = _get_r2_client(settings)
    key = f"{prefix.rstrip('/')}/manifest.json"
    try:
        response = client.get_object(Bucket=settings.R2_BUCKET, Key=key)
        body = response["Body"].read().decode("utf-8")
        return json.loads(body)
    except Exception as exc:
        raise RuntimeError(f"Failed to load manifest {key}: {exc}") from exc


def sign_clip_urls(settings: Settings, prefix: str, clip_files: List[str]) -> List[str]:
    # Generate signed download URLs for clip files.
    client = _get_r2_client(settings)
    urls: List[str] = []
    for clip_file in clip_files:
        key = f"{prefix.rstrip('/')}/clips/{clip_file}"
        try:
            url = client.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.R2_BUCKET, "Key": key},
                ExpiresIn=3600,
            )
        except Exception as exc:
            raise RuntimeError(f"Failed to sign URL for {key}: {exc}") from exc
        urls.append(url)
    return urls
