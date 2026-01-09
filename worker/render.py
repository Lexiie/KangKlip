from pathlib import Path
import subprocess
from typing import List

try:
    from .llm import ClipSpec
    from .io_utils import run_cmd
except ImportError as exc:
    if "attempted relative import" not in str(exc):
        raise
    from llm import ClipSpec
    from io_utils import run_cmd


def _has_nvenc() -> bool:
    # Check whether ffmpeg exposes the h264_nvenc encoder.
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception:
        return False
    return "h264_nvenc" in result.stdout


def render_clips(video_path: Path, output_dir: Path, clips: List[ClipSpec]) -> List[Path]:
    # Render each clip using ffmpeg.
    outputs: List[Path] = []
    crop_filter = (
        "crop="
        "if(gte(iw/ih,9/16),ih*9/16,iw):"
        "if(gte(iw/ih,9/16),ih,iw*16/9),"
        "scale=1080:1920"
    )
    use_nvenc = _has_nvenc()
    video_codec = "h264_nvenc" if use_nvenc else "libx264"
    preset = "fast" if use_nvenc else "veryfast"
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
                video_codec,
                "-preset",
                preset,
                "-c:a",
                "aac",
                str(output_path),
            ]
        )
        outputs.append(output_path)
    return outputs
