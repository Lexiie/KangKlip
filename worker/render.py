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
    # Check whether ffmpeg exposes the encoder and the NVENC runtime is present.
    if not Path("/usr/lib/x86_64-linux-gnu/libnvidia-encode.so.1").exists():
        return False
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


def _has_audio(video_path: Path) -> bool:
    # Check if the input video has an audio stream.
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "csv=p=0",
                str(video_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception:
        return False
    return bool(result.stdout.strip())


def _render_montage(
    video_path: Path,
    output_path: Path,
    crop_filter: str,
    clip: ClipSpec,
    video_codec: str,
    preset: str,
    has_audio: bool,
) -> None:
    # Render a multi-segment clip with ffmpeg concat filter.
    filters: List[str] = []
    for idx, segment in enumerate(clip.segments):
        v_label = f"v{idx}"
        filters.append(
            "[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS,{crop}[{label}]".format(
                start=segment.start,
                end=segment.end,
                crop=crop_filter,
                label=v_label,
            )
        )
        if has_audio:
            a_label = f"a{idx}"
            filters.append(
                "[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[{label}]".format(
                    start=segment.start,
                    end=segment.end,
                    label=a_label,
                )
            )
    if has_audio:
        concat_inputs = "".join(
            f"[{v}][{a}]"
            for v, a in zip(
                (f"v{idx}" for idx in range(len(clip.segments))),
                (f"a{idx}" for idx in range(len(clip.segments))),
            )
        )
        filters.append(f"{concat_inputs}concat=n={len(clip.segments)}:v=1:a=1[v][a]")
    else:
        concat_inputs = "".join(f"[v{idx}]" for idx in range(len(clip.segments)))
        filters.append(f"{concat_inputs}concat=n={len(clip.segments)}:v=1:a=0[v]")
    args = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[v]",
        "-c:v",
        video_codec,
        "-preset",
        preset,
    ]
    if has_audio:
        args += ["-map", "[a]", "-c:a", "aac"]
    else:
        args += ["-an"]
    args.append(str(output_path))
    run_cmd(args)


def render_clips(video_path: Path, output_dir: Path, clips: List[ClipSpec]) -> List[Path]:
    # Render each clip using ffmpeg.
    outputs: List[Path] = []
    crop_filter = (
        "crop="
        "if(gte(iw/ih\,9/16)\,ih*9/16\,iw):"
        "if(gte(iw/ih\,9/16)\,ih\,iw*16/9),"
        "scale=1080:1920"
    )
    use_nvenc = _has_nvenc()
    video_codec = "h264_nvenc" if use_nvenc else "libx264"
    preset = "fast" if use_nvenc else "veryfast"
    has_audio = _has_audio(video_path)
    for clip in clips:
        output_path = output_dir / f"clip_{clip.index:02d}.mp4"
        try:
            if len(clip.segments) == 1:
                segment = clip.segments[0]
                args = [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    str(segment.start),
                    "-to",
                    str(segment.end),
                    "-i",
                    str(video_path),
                    "-vf",
                    crop_filter,
                    "-c:v",
                    video_codec,
                    "-preset",
                    preset,
                ]
                if has_audio:
                    args += ["-c:a", "aac"]
                else:
                    args += ["-an"]
                args.append(str(output_path))
                run_cmd(args)
            else:
                _render_montage(
                    video_path,
                    output_path,
                    crop_filter,
                    clip,
                    video_codec,
                    preset,
                    has_audio,
                )
        except RuntimeError:
            if len(clip.segments) == 1:
                segment = clip.segments[0]
                args = [
                    "ffmpeg",
                    "-y",
                    "-ss",
                    str(segment.start),
                    "-to",
                    str(segment.end),
                    "-i",
                    str(video_path),
                    "-vf",
                    crop_filter,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                ]
                if has_audio:
                    args += ["-c:a", "aac"]
                else:
                    args += ["-an"]
                args.append(str(output_path))
                run_cmd(args)
            else:
                _render_montage(
                    video_path,
                    output_path,
                    crop_filter,
                    clip,
                    "libx264",
                    "veryfast",
                    has_audio,
                )
        outputs.append(output_path)
    return outputs
