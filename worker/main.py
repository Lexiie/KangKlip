from pathlib import Path

import orjson

from .config import load_config
from .io_utils import ensure_dirs, download_video, extract_audio
from .llm import llm_select_segments, build_manifest, clip_to_edl
from .render import render_clips
from .storage import upload_to_r2, callback_backend
from .transcript import fetch_captions, transcribe_audio, chunk_transcript


def main() -> None:
    # Execute the full worker pipeline.
    config = load_config()

    base_dir = Path("/work")
    input_dir = base_dir / "input"
    artifacts_dir = base_dir / "artifacts"
    output_dir = base_dir / "output"
    ensure_dirs([input_dir, artifacts_dir, output_dir])

    video_path = input_dir / "source.mp4"
    meta_path = artifacts_dir / "source_meta.json"
    audio_path = input_dir / "audio.wav"
    transcript_path = artifacts_dir / "transcript.json"
    chunks_path = artifacts_dir / "chunks.json"
    edl_path = artifacts_dir / "edl.json"

    try:
        download_video(config.video_url, video_path, meta_path)
        extract_audio(video_path, audio_path)
        transcript = fetch_captions(config.video_url, artifacts_dir, config.language)
        if not transcript:
            transcript = transcribe_audio(audio_path, config.language)
        transcript_payload = [entry.__dict__ for entry in transcript]
        transcript_path.write_bytes(orjson.dumps(transcript_payload))
        chunks = chunk_transcript(transcript)
        chunks_path.write_bytes(orjson.dumps(chunks))
        clips = llm_select_segments(
            config,
            chunks,
            config.clip_count,
            config.min_clip_seconds,
            config.max_clip_seconds,
        )
        if not clips:
            raise RuntimeError("No valid clips produced")
        edl_path.write_bytes(orjson.dumps(clip_to_edl(config.job_id, clips)))
        clip_files = render_clips(video_path, output_dir, clips)
        manifest = build_manifest(config.job_id, clips)
        upload_to_r2(
            config.r2_endpoint,
            config.r2_bucket,
            config.r2_access_key,
            config.r2_secret_key,
            config.r2_prefix,
            [transcript_path, chunks_path, edl_path, meta_path],
            clip_files,
            manifest,
        )
        callback_backend(
            config.callback_url,
            {"job_id": config.job_id, "status": "SUCCEEDED", "r2_prefix": config.r2_prefix},
        )
    except Exception as exc:
        error_message = str(exc)
        callback_backend(
            config.callback_url,
            {"job_id": config.job_id, "status": "FAILED", "error": error_message},
        )
        raise


if __name__ == "__main__":
    # Run the worker in CLI mode.
    main()
