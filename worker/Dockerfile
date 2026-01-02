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

COPY worker.py /app/worker.py

ENV PYTHONUNBUFFERED=1

CMD ["python3", "/app/worker.py"]
