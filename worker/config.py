import os
from dataclasses import dataclass
from typing import Optional


@dataclass
class WorkerConfig:
    # Hold environment configuration for the worker runtime.
    job_id: str
    video_url: str
    clip_count: int
    min_clip_seconds: int
    max_clip_seconds: int
    language: str
    callback_url: str
    callback_token: Optional[str]
    r2_endpoint: str
    r2_bucket: str
    r2_access_key: str
    r2_secret_key: str
    r2_prefix: str
    llm_api_base: str
    llm_api_key: Optional[str]
    llm_timeout_seconds: int
    llm_model_name: str
    asr_model: str


def read_env(name: str, default: Optional[str] = None) -> str:
    # Read an environment variable or raise if missing.
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def load_config() -> WorkerConfig:
    # Load worker configuration from environment variables.
    llm_api_base = read_env("LLM_API_BASE")
    llm_api_key = os.getenv("LLM_API_KEY")
    llm_model_name = read_env("LLM_MODEL_NAME")
    if "generativelanguage.googleapis.com" in llm_api_base and not llm_api_key:
        raise RuntimeError("Missing required env var: LLM_API_KEY")
    return WorkerConfig(
        job_id=read_env("JOB_ID"),
        video_url=read_env("VIDEO_URL"),
        clip_count=int(read_env("CLIP_COUNT")),
        min_clip_seconds=int(read_env("MIN_CLIP_SECONDS", "30")),
        max_clip_seconds=int(read_env("MAX_CLIP_SECONDS", "60")),
        language=read_env("OUTPUT_LANGUAGE", "auto"),
        callback_url=read_env("CALLBACK_URL"),
        callback_token=os.getenv("CALLBACK_TOKEN"),
        r2_endpoint=read_env("R2_ENDPOINT"),
        r2_bucket=read_env("R2_BUCKET"),
        r2_access_key=read_env("R2_ACCESS_KEY_ID"),
        r2_secret_key=read_env("R2_SECRET_ACCESS_KEY"),
        r2_prefix=read_env("R2_PREFIX"),
        llm_api_base=llm_api_base,
        llm_api_key=llm_api_key,
        llm_timeout_seconds=int(read_env("LLM_TIMEOUT_SECONDS", "20")),
        llm_model_name=llm_model_name,
        asr_model=read_env("ASR_MODEL", "small"),
    )
