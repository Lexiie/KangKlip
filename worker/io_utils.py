import subprocess
from pathlib import Path
from typing import List, Optional


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
