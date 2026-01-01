import json
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

import boto3
import httpx
import orjson
from botocore.config import Config


@dataclass
class TranscriptEntry:
    # Represent a transcript segment with timing.
    text: str
    start: float
    duration: float


@dataclass
class ClipSpec:
    # Represent a clip selection for rendering.
    index: int
    title: str
    hook: str
    start: float
    end: float


def read_env(name: str, default: Optional[str] = None) -> str:
    # Read an environment variable or raise if missing.
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def ensure_dirs(paths: List[Path]) -> None:
    # Ensure required directories exist on disk.
    for path in paths:
        path.mkdir(parents=True, exist_ok=True)


def run_cmd(args: List[str], cwd: Optional[Path] = None) -> None:
    # Execute a subprocess command with error handling.
    try:
        subprocess.run(args, cwd=cwd, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"Command failed: {' '.join(args)}") from exc


def download_video(video_url: str, output_path: Path, meta_path: Path) -> None:
    # Download the source video and store metadata.
    run_cmd([
        "yt-dlp",
        "-f",
        "mp4",
        "-o",
        str(output_path),
        "--write-info-json",
        "--no-playlist",
        video_url,
    ])
    info_path = output_path.with_suffix(".info.json")
    if info_path.exists():
        info_path.replace(meta_path)


def extract_audio(video_path: Path, audio_path: Path) -> None:
    # Extract PCM audio for ASR fallback.
    run_cmd([
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(audio_path),
    ])


def parse_vtt(path: Path) -> List[TranscriptEntry]:
    # Parse WebVTT captions into transcript entries.
    entries: List[TranscriptEntry] = []
    if not path.exists():
        return entries
    lines = path.read_text(encoding="utf-8").splitlines()
    idx = 0
    while idx < len(lines):
        line = lines[idx].strip()
        if "-->" in line:
            parts = line.split("-->")
            start = _parse_timestamp(parts[0].strip())
            end = _parse_timestamp(parts[1].strip().split(" ")[0])
            idx += 1
            text_lines: List[str] = []
            while idx < len(lines) and lines[idx].strip() != "":
                text_lines.append(lines[idx].strip())
                idx += 1
            text = " ".join(text_lines).strip()
            if text:
                entries.append(
                    TranscriptEntry(text=text, start=start, duration=max(0.0, end - start))
                )
        idx += 1
    return entries


def _parse_timestamp(value: str) -> float:
    # Parse VTT timestamp into seconds.
    parts = value.replace(",", ".").split(":")
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + float(part)
    return seconds


def fetch_captions(video_url: str, output_dir: Path, language: str) -> List[TranscriptEntry]:
    # Attempt to fetch existing captions using yt-dlp.
    subtitle_path = output_dir / "captions.vtt"
    args = [
        "yt-dlp",
        "--skip-download",
        "--write-sub",
        "--write-auto-sub",
        "--sub-format",
        "vtt",
        "-o",
        str(output_dir / "captions"),
    ]
    if language != "auto":
        args.extend(["--sub-lang", language])
    args.append(video_url)
    run_cmd(args)
    for candidate in output_dir.glob("captions*.vtt"):
        candidate.replace(subtitle_path)
        break
    return parse_vtt(subtitle_path)


def transcribe_audio(audio_path: Path, language: str) -> List[TranscriptEntry]:
    # Run faster-whisper ASR to generate transcript entries.
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        raise RuntimeError("faster-whisper is not available") from exc
    model = WhisperModel("small", device="cuda", compute_type="int8")
    segments, _ = model.transcribe(
        str(audio_path),
        language=None if language == "auto" else language,
        vad_filter=True,
    )
    entries: List[TranscriptEntry] = []
    for segment in segments:
        entries.append(
            TranscriptEntry(text=segment.text.strip(), start=segment.start, duration=segment.end - segment.start)
        )
    return entries


def chunk_transcript(entries: List[TranscriptEntry]) -> List[Dict[str, float]]:
    # Merge transcript entries into 10-20 second chunks.
    chunks: List[Dict[str, float]] = []
    buffer_text: List[str] = []
    buffer_start = None
    buffer_end = None
    for entry in entries:
        if buffer_start is None:
            buffer_start = entry.start
            buffer_end = entry.start + entry.duration
        else:
            buffer_end = entry.start + entry.duration
        buffer_text.append(entry.text)
        if buffer_end - buffer_start >= 10.0:
            chunks.append(
                {
                    "text": " ".join(buffer_text).strip(),
                    "start": buffer_start,
                    "end": buffer_end,
                }
            )
            buffer_text = []
            buffer_start = None
            buffer_end = None
        if buffer_start is not None and buffer_end is not None and buffer_end - buffer_start >= 20.0:
            chunks.append(
                {
                    "text": " ".join(buffer_text).strip(),
                    "start": buffer_start,
                    "end": buffer_end,
                }
            )
            buffer_text = []
            buffer_start = None
            buffer_end = None
    if buffer_text and buffer_start is not None and buffer_end is not None:
        chunks.append(
            {
                "text": " ".join(buffer_text).strip(),
                "start": buffer_start,
                "end": buffer_end,
            }
        )
    return chunks


def llm_select_segments(
    job_id: str,
    chunks: List[Dict[str, float]],
    clip_count: int,
    min_seconds: int,
    max_seconds: int,
) -> List[ClipSpec]:
    # Select clip segments using a local vLLM model, fallback to heuristic.
    try:
        from vllm import LLM, SamplingParams
    except Exception:
        return heuristic_select(chunks, clip_count, min_seconds, max_seconds)
    prompt = _build_prompt(chunks, clip_count, min_seconds, max_seconds)
    llm = LLM(model="qwen2.5-3b", dtype="auto", max_model_len=4096)
    params = SamplingParams(temperature=0.2, max_tokens=512)
    try:
        outputs = llm.generate([prompt], params)
        text = outputs[0].outputs[0].text
        data = json.loads(_extract_json(text))
        clips = []
        for clip in data.get("clips", []):
            clips.append(
                ClipSpec(
                    index=int(clip.get("index", 0)),
                    title=str(clip.get("title", "")),
                    hook=str(clip.get("hook", "")),
                    start=float(clip.get("start", 0.0)),
                    end=float(clip.get("end", 0.0)),
                )
            )
        validated = validate_clips(clips, clip_count, min_seconds, max_seconds)
        if not validated:
            raise RuntimeError("empty LLM clip list")
        return validated
    except Exception:
        return heuristic_select(chunks, clip_count, min_seconds, max_seconds)


def _build_prompt(chunks: List[Dict[str, float]], clip_count: int, min_seconds: int, max_seconds: int) -> str:
    # Build a structured prompt for clip selection.
    return (
        "You are selecting highlight clips. Return JSON only. "
        f"Need {clip_count} clips, duration {min_seconds}-{max_seconds}s, non-overlapping. "
        "Chunks: "
        + json.dumps(chunks)
    )


def _extract_json(text: str) -> str:
    # Extract JSON object from a string.
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise RuntimeError("LLM output missing JSON")
    return text[start : end + 1]


def heuristic_select(
    chunks: List[Dict[str, float]],
    clip_count: int,
    min_seconds: int,
    max_seconds: int,
) -> List[ClipSpec]:
    # Use a deterministic fallback to pick early chunks for clips.
    clips: List[ClipSpec] = []
    for idx, chunk in enumerate(chunks[:clip_count], start=1):
        start = float(chunk["start"])
        end = min(float(chunk["end"]), start + max_seconds)
        if end - start < min_seconds:
            end = start + min_seconds
        clips.append(
            ClipSpec(
                index=idx,
                title=f"Clip {idx}",
                hook=chunk.get("text", "")[:120],
                start=start,
                end=end,
            )
        )
    return validate_clips(clips, clip_count, min_seconds, max_seconds)


def validate_clips(
    clips: List[ClipSpec],
    clip_count: int,
    min_seconds: int,
    max_seconds: int,
) -> List[ClipSpec]:
    # Validate clip boundaries, durations, and overlaps.
    sanitized: List[ClipSpec] = []
    last_end = -1.0
    for clip in clips:
        if clip.start < 0 or clip.end <= clip.start:
            continue
        duration = clip.end - clip.start
        if duration < min_seconds or duration > max_seconds:
            continue
        if clip.start < last_end:
            continue
        sanitized.append(clip)
        last_end = clip.end
    return sanitized[:clip_count]


def render_clips(video_path: Path, output_dir: Path, clips: List[ClipSpec]) -> List[Path]:
    # Render each clip using ffmpeg.
    outputs: List[Path] = []
    crop_filter = (
        "crop="
        "if(gte(iw/ih,9/16),ih*9/16,iw):"
        "if(gte(iw/ih,9/16),ih,iw*16/9),"
        "scale=1080:1920"
    )
    for clip in clips:
        output_path = output_dir / f"clip_{clip.index:02d}.mp4"
        run_cmd(
            [
                "ffmpeg",
                "-y",
                "-ss",
                str(clip.start),
                "-to",
                str(clip.end),
                "-i",
                str(video_path),
                "-vf",
                crop_filter,
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                str(output_path),
            ]
        )
        outputs.append(output_path)
    return outputs


def upload_to_r2(
    r2_endpoint: str,
    r2_bucket: str,
    access_key: str,
    secret_key: str,
    prefix: str,
    artifacts: List[Path],
    clips: List[Path],
    manifest: Dict[str, object],
) -> None:
    # Upload artifacts and clips to R2 with deterministic paths.
    client = boto3.client(
        "s3",
        endpoint_url=r2_endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )
    manifest_key = f"{prefix.rstrip('/')}/manifest.json"
    client.put_object(Bucket=r2_bucket, Key=manifest_key, Body=orjson.dumps(manifest))
    for artifact in artifacts:
        key = f"{prefix.rstrip('/')}/{artifact.name}"
        client.upload_file(str(artifact), r2_bucket, key)
    for clip in clips:
        key = f"{prefix.rstrip('/')}/clips/{clip.name}"
        client.upload_file(str(clip), r2_bucket, key)


def callback_backend(callback_url: str, payload: Dict[str, object]) -> None:
    # Notify backend about job completion.
    try:
        response = httpx.post(callback_url, json=payload, timeout=15.0)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Callback failed: {exc}") from exc


def build_manifest(job_id: str, clips: List[ClipSpec]) -> Dict[str, object]:
    # Build manifest content for uploads.
    return {
        "job_id": job_id,
        "clips": [
            {
                "index": clip.index,
                "title": clip.title,
                "hook": clip.hook,
                "start": clip.start,
                "end": clip.end,
                "duration": int(clip.end - clip.start),
                "file": f"clip_{clip.index:02d}.mp4",
            }
            for clip in clips
        ],
    }


def main() -> None:
    # Execute the full worker pipeline.
    job_id = read_env("JOB_ID")
    video_url = read_env("VIDEO_URL")
    clip_count = int(read_env("CLIP_COUNT"))
    min_clip = int(read_env("MIN_CLIP_SECONDS", "30"))
    max_clip = int(read_env("MAX_CLIP_SECONDS", "60"))
    language = read_env("OUTPUT_LANGUAGE", "auto")
    callback_url = read_env("CALLBACK_URL")
    r2_endpoint = read_env("R2_ENDPOINT")
    r2_bucket = read_env("R2_BUCKET")
    r2_access = read_env("R2_ACCESS_KEY_ID")
    r2_secret = read_env("R2_SECRET_ACCESS_KEY")
    r2_prefix = read_env("R2_PREFIX")

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
        download_video(video_url, video_path, meta_path)
        extract_audio(video_path, audio_path)
        transcript = fetch_captions(video_url, artifacts_dir, language)
        if not transcript:
            transcript = transcribe_audio(audio_path, language)
        transcript_payload = [entry.__dict__ for entry in transcript]
        transcript_path.write_bytes(orjson.dumps(transcript_payload))
        chunks = chunk_transcript(transcript)
        chunks_path.write_bytes(orjson.dumps(chunks))
        clips = llm_select_segments(job_id, chunks, clip_count, min_clip, max_clip)
        if not clips:
            raise RuntimeError("No valid clips produced")
        edl_payload = {
            "job_id": job_id,
            "clips": [
                {
                    "index": clip.index,
                    "title": clip.title,
                    "hook": clip.hook,
                    "start": clip.start,
                    "end": clip.end,
                }
                for clip in clips
            ],
        }
        edl_path.write_bytes(orjson.dumps(edl_payload))
        clip_files = render_clips(video_path, output_dir, clips)
        manifest = build_manifest(job_id, clips)
        upload_to_r2(
            r2_endpoint,
            r2_bucket,
            r2_access,
            r2_secret,
            r2_prefix,
            [transcript_path, chunks_path, edl_path, meta_path],
            clip_files,
            manifest,
        )
        callback_backend(
            callback_url,
            {"job_id": job_id, "status": "SUCCEEDED", "r2_prefix": r2_prefix},
        )
    except Exception as exc:
        error_message = str(exc)
        callback_backend(
            callback_url,
            {"job_id": job_id, "status": "FAILED", "error": error_message},
        )
        raise


if __name__ == "__main__":
    # Run the worker in CLI mode.
    main()
