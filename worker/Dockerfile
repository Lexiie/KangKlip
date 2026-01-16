FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    unzip \
    libgl1 \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt

RUN python3 -m pip install --upgrade pip \
  && python3 -m pip install --no-cache-dir -r /app/requirements.txt \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && curl -fsSL https://bun.sh/install | bash \
  && ln -s /root/.bun/bin/bun /usr/local/bin/bun

RUN mkdir -p /app/models/face \
  && curl -fsSL https://raw.githubusercontent.com/opencv/opencv/master/samples/dnn/face_detector/opencv_face_detector.pbtxt \
    -o /app/models/face/opencv_face_detector.pbtxt \
  && curl -fsSL https://raw.githubusercontent.com/opencv/opencv_3rdparty/master/dnn_samples_face_detector/opencv_face_detector_uint8.pb \
    -o /app/models/face/opencv_face_detector_uint8.pb

ENV HF_HOME=/models/hf
ENV HF_HUB_DISABLE_TELEMETRY=1
ENV HUGGINGFACE_HUB_DISABLE_TELEMETRY=1

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
