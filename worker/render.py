from pathlib import Path
from typing import List

try:
    from .llm import ClipSpec
    from .io_utils import run_cmd
except ImportError as exc:
    if "attempted relative import" not in str(exc):
        raise
    from llm import ClipSpec
    from io_utils import run_cmd


def render_clips(video_path: Path, output_dir: Path, clips: List[ClipSpec]) -> List[Path]:
    # Render each clip using ffmpeg.
    outputs: List[Path] = []
    crop_filter = (
        "crop="
        "if(gte(iw/ih,9/16),ih*9/16,iw):"
        "if(gte(iw/ih,9/16),ih,iw*16/9),"
        "scale=1080:1920"
    )
    video_codec = "h264_nvenc"
    preset = "fast"
    for clip in clips:
        output_path = output_dir / f"clip_{clip.index:02d}.mp4"
        try:
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
        except RuntimeError:
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
