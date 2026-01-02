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
    r2_endpoint: str
    r2_bucket: str
    r2_access_key: str
    r2_secret_key: str
    r2_prefix: str
    llm_model: str
    llm_context_tokens: int
    llm_quantization: Optional[str]
    llm_gpu_memory_util: float


def read_env(name: str, default: Optional[str] = None) -> str:
    # Read an environment variable or raise if missing.
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def load_config() -> WorkerConfig:
    # Load worker configuration from environment variables.
    llm_quantization = read_env("LLM_QUANTIZATION", "awq")
    if llm_quantization.lower() in {"none", ""}:
        llm_quantization = None
    return WorkerConfig(
        job_id=read_env("JOB_ID"),
        video_url=read_env("VIDEO_URL"),
        clip_count=int(read_env("CLIP_COUNT")),
        min_clip_seconds=int(read_env("MIN_CLIP_SECONDS", "30")),
        max_clip_seconds=int(read_env("MAX_CLIP_SECONDS", "60")),
        language=read_env("OUTPUT_LANGUAGE", "auto"),
        callback_url=read_env("CALLBACK_URL"),
        r2_endpoint=read_env("R2_ENDPOINT"),
        r2_bucket=read_env("R2_BUCKET"),
        r2_access_key=read_env("R2_ACCESS_KEY_ID"),
        r2_secret_key=read_env("R2_SECRET_ACCESS_KEY"),
        r2_prefix=read_env("R2_PREFIX"),
        llm_model=read_env("LLM_MODEL", "Qwen/Qwen2.5-3B-Instruct-AWQ"),
        llm_context_tokens=int(read_env("LLM_CONTEXT_TOKENS", "4096")),
        llm_quantization=llm_quantization,
        llm_gpu_memory_util=float(read_env("LLM_GPU_MEMORY_UTIL", "0.7")),
    )
