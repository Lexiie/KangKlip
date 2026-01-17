from pathlib import Path
import sys
import traceback

import orjson

try:
    from .config import load_config
    from .io_utils import ensure_dirs, download_video, extract_audio
    from .llm import llm_select_segments, build_manifest, clip_to_edl, get_last_selection
    from .render import render_clips
    from .storage import upload_to_r2, callback_backend, upload_error
    from .transcript import transcribe_audio, chunk_transcript
except ImportError as exc:
    if "attempted relative import" not in str(exc):
        raise
    from config import load_config
    from io_utils import ensure_dirs, download_video, extract_audio
    from llm import llm_select_segments, build_manifest, clip_to_edl, get_last_selection
    from render import render_clips
    from storage import upload_to_r2, callback_backend, upload_error
    from transcript import transcribe_audio, chunk_transcript


def main() -> None:
    # Execute the full worker pipeline.
    config = load_config()

    def log(message: str) -> None:
        print(message)
        sys.stdout.flush()

    def report(stage: str, progress: int) -> None:
        try:
            callback_backend(
                config.callback_url,
                {
                    "job_id": config.job_id,
                    "status": "RUNNING",
                    "stage": stage,
                    "progress": progress,
                },
            )
        except Exception:
            # Best-effort progress update; do not fail the job.
            pass

    log(f"worker start job_id={config.job_id}")

    base_dir = Path("/work")
    input_dir = base_dir / "input"
    artifacts_dir = base_dir / "artifacts"
    output_dir = base_dir / "output"
    ensure_dirs([input_dir, artifacts_dir, output_dir])

    video_path = input_dir / "source.mp4"
    meta_path = artifacts_dir / "meta.json"
    stats_path = artifacts_dir / "video_stats.json"
    audio_path = input_dir / "audio.wav"
    transcript_path = artifacts_dir / "transcript.json"
    chunks_path = artifacts_dir / "chunks.json"
    edl_path = artifacts_dir / "edl.json"

    try:
        report("DOWNLOAD", 5)
        log("download video")
        download_video(config.video_url, video_path, meta_path)
        if not video_path.exists() or video_path.stat().st_size == 0:
            raise RuntimeError("Downloaded video missing or empty")
        log(f"video size={video_path.stat().st_size}")
        report("DOWNLOAD", 20)
        stats_path.write_bytes(
            orjson.dumps({"size_bytes": video_path.stat().st_size})
        )
        log("extract audio")
        extract_audio(video_path, audio_path)
        log("transcribe audio")
        transcript = transcribe_audio(audio_path, config.language, config.asr_model)
        report("TRANSCRIPT", 40)
        log("chunk transcript")
        transcript_payload = [entry.__dict__ for entry in transcript]
        transcript_path.write_bytes(orjson.dumps(transcript_payload))
        chunks = chunk_transcript(transcript)
        chunks_path.write_bytes(orjson.dumps(chunks))
        report("CHUNK", 55)
        log("llm select")
        clips = llm_select_segments(
            config,
            chunks,
            config.clip_count,
            config.min_clip_seconds,
            config.max_clip_seconds,
        )
        if not clips:
            raise RuntimeError("No valid clips produced")
        report("SELECT", 65)
        log("render clips")
        edl_path.write_bytes(orjson.dumps(clip_to_edl(config.job_id, clips)))
        clip_files = render_clips(video_path, output_dir, clips, transcript)
        for clip_file in clip_files:
            if not clip_file.exists() or clip_file.stat().st_size == 0:
                raise RuntimeError(f"Rendered clip missing or empty: {clip_file}")
            log(f"clip output={clip_file} size={clip_file.stat().st_size}")
        try:
            output_names = ", ".join(p.name for p in output_dir.iterdir())
            log(f"output dir: {output_names}")
        except Exception:
            pass
        report("RENDER", 80)
        manifest = build_manifest(config.job_id, clips)
        manifest["selection"] = get_last_selection()
        log("upload artifacts")
        artifact_files = [transcript_path, chunks_path, edl_path, meta_path, stats_path]
        face_log_path = output_dir / "face_log.json"
        if face_log_path.exists():
            artifact_files.append(face_log_path)
        upload_to_r2(
            config.r2_endpoint,
            config.r2_bucket,
            config.r2_access_key,
            config.r2_secret_key,
            config.r2_prefix,
            artifact_files,
            clip_files,
            manifest,
        )
        report("UPLOAD", 95)
        log("callback success")
        callback_backend(
            config.callback_url,
            {"job_id": config.job_id, "status": "SUCCEEDED", "r2_prefix": config.r2_prefix},
        )
    except Exception as exc:
        error_message = str(exc)
        print(f"worker error: {error_message}", file=sys.stderr)
        traceback.print_exc()
        try:
            log("upload error payload")
            upload_error(
                config.r2_endpoint,
                config.r2_bucket,
                config.r2_access_key,
                config.r2_secret_key,
                config.r2_prefix,
                {"job_id": config.job_id, "error": error_message},
            )
        except Exception:
            pass
        log("callback failed")
        callback_backend(
            config.callback_url,
            {"job_id": config.job_id, "status": "FAILED", "error": error_message},
        )
        raise


if __name__ == "__main__":
    # Run the worker in CLI mode.
    main()
