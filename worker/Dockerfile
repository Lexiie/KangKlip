FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    git \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt

RUN python3 -m pip install --upgrade pip \
  && python3 -m pip install --no-cache-dir -r /app/requirements.txt \
  && python3 -m pip install --no-cache-dir yt-dlp

ARG HF_TOKEN=
ARG LLM_REPO=Qwen/Qwen2.5-3B-Instruct-AWQ
ARG WHISPER_MODEL=small

ENV HF_HOME=/models/hf
ENV TRANSFORMERS_CACHE=/models/hf
ENV HF_HUB_DISABLE_TELEMETRY=1
ENV HUGGINGFACE_HUB_DISABLE_TELEMETRY=1

RUN python3 - <<'PY'
import os
from huggingface_hub import snapshot_download

token = os.getenv("HF_TOKEN") or None
repo_id = os.getenv("LLM_REPO")
cache_dir = os.getenv("HF_HOME", "/models/hf")
snapshot_download(repo_id=repo_id, cache_dir=cache_dir, token=token, local_dir_use_symlinks=False)

from faster_whisper import WhisperModel
WhisperModel(os.getenv("WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
PY

COPY worker.py /app/worker.py

ENV PYTHONUNBUFFERED=1

CMD ["python3", "/app/worker.py"]
