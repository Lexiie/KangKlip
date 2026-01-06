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

RUN python3 - <<'PY'
from faster_whisper import WhisperModel
WhisperModel("small", device="cpu", compute_type="int8")
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
