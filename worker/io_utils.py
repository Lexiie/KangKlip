import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional


def ensure_dirs(paths: List[Path]) -> None:
    # Ensure required directories exist on disk.
    for path in paths:
        path.mkdir(parents=True, exist_ok=True)


def run_cmd(args: List[str], cwd: Optional[Path] = None) -> None:
    # Execute a subprocess command with error handling.
    def _tail(path: Path, limit: int = 4000) -> str:
        try:
            data = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return ""
        if len(data) > limit:
            return data[-limit:]
        return data

    with tempfile.TemporaryDirectory() as tmp_dir:
        stdout_path = Path(tmp_dir) / "stdout.txt"
        stderr_path = Path(tmp_dir) / "stderr.txt"
        with stdout_path.open("w", encoding="utf-8") as stdout_file, stderr_path.open(
            "w", encoding="utf-8"
        ) as stderr_file:
            result = subprocess.run(
                args,
                cwd=cwd,
                stdout=stdout_file,
                stderr=stderr_file,
                text=True,
            )
        if result.returncode == 0:
            return
        stderr = _tail(stderr_path).strip()
        stdout = _tail(stdout_path).strip()
        details = ""
        if stderr:
            details = f"\n{stderr}"
        elif stdout:
            details = f"\n{stdout}"
        raise RuntimeError(f"Command failed: {' '.join(args)}{details}")


def download_video(video_url: str, output_path: Path, meta_path: Path) -> None:
    # Download the source video and store metadata.
    run_cmd([
        "yt-dlp",
        "-f",
        "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080][vcodec^=avc1]+bestaudio/best[height<=1080][ext=mp4][acodec!=none]/b[ext=mp4][acodec!=none]",
        "--merge-output-format",
        "mp4",
        "--js-runtimes",
        "bun",
        "-o",
        str(output_path),
        "--write-info-json",
        "--no-playlist",
        "--concurrent-fragments",
        "8",
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
