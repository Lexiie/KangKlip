FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt

RUN python3 -m pip install --upgrade pip \
  && python3 -m pip install --no-cache-dir -r /app/requirements.txt \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && curl -fsSL https://bun.sh/install | bash \
  && ln -s /root/.bun/bin/bun /usr/local/bin/bun

ENV HF_HOME=/models/hf
ENV HF_HUB_DISABLE_TELEMETRY=1
ENV HUGGINGFACE_HUB_DISABLE_TELEMETRY=1

RUN python3 - <<'PY'
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="Systran/faster-whisper-base",
    cache_dir="/models/hf",
    local_dir_use_symlinks=False,
)
PY


COPY __init__.py /app/__init__.py
COPY config.py /app/config.py
COPY io_utils.py /app/io_utils.py
COPY transcript.py /app/transcript.py
COPY llm.py /app/llm.py
COPY render.py /app/render.py
COPY storage.py /app/storage.py
COPY main.py /app/main.py

ENV PYTHONUNBUFFERED=1

CMD ["python3", "/app/main.py"]
