#!/usr/bin/env python3
"""Local worker smoke test without Docker.

Runs download + transcript + render using worker utilities.
"""

from pathlib import Path

from worker.io_utils import ensure_dirs, download_video, extract_audio
from worker.transcript import fetch_captions, transcribe_audio, chunk_transcript
from worker.llm import llm_select_segments
from worker.render import render_clips
from worker.config import load_config


def main() -> None:
    config = load_config()

    base_dir = Path("/tmp/worker-local")
    input_dir = base_dir / "input"
    artifacts_dir = base_dir / "artifacts"
    output_dir = base_dir / "output"
    ensure_dirs([input_dir, artifacts_dir, output_dir])

    video_path = input_dir / "source.mp4"
    meta_path = artifacts_dir / "meta.json"
    audio_path = input_dir / "audio.wav"
    transcript_path = artifacts_dir / "transcript.json"
    chunks_path = artifacts_dir / "chunks.json"

    print("fetch captions")
    transcript = fetch_captions(config.video_url, artifacts_dir, config.language)

    print("download video")
    download_video(config.video_url, video_path, meta_path)

    if not transcript:
        print("extract audio")
        extract_audio(video_path, audio_path)
        print("transcribe audio")
        transcript = transcribe_audio(audio_path, config.language)

    transcript_payload = [entry.__dict__ for entry in transcript]
    transcript_path.write_text(str(transcript_payload), encoding="utf-8")

    print("chunk transcript")
    chunks = chunk_transcript(transcript)
    chunks_path.write_text(str(chunks), encoding="utf-8")

    print("llm select")
    clips = llm_select_segments(
        config,
        chunks,
        config.clip_count,
        config.min_clip_seconds,
        config.max_clip_seconds,
    )
    if not clips:
        raise RuntimeError("No valid clips produced")

    print("render clips")
    render_clips(video_path, output_dir, clips)
    print("done")


if __name__ == "__main__":
    main()
