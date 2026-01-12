from pathlib import Path
import subprocess
from typing import Iterable, List, Optional

try:
    from .llm import ClipSpec
    from .io_utils import run_cmd
    from .transcript import TranscriptEntry
except ImportError as exc:
    if "attempted relative import" not in str(exc):
        raise
    from llm import ClipSpec
    from io_utils import run_cmd
    from transcript import TranscriptEntry


def _format_ass_time(seconds: float) -> str:
    # Format seconds into ASS timestamp (H:MM:SS.cc).
    total_cs = max(0, int(round(seconds * 100)))
    hours = total_cs // 360000
    minutes = (total_cs % 360000) // 6000
    secs = (total_cs % 6000) // 100
    centis = total_cs % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def _wrap_caption(text: str, max_chars: int = 28, max_lines: int = 3) -> List[str]:
    # Wrap captions into short lines to fit 9:16 safely.
    words = [word for word in text.replace("\n", " ").split(" ") if word]
    if not words:
        return []
    lines: List[str] = []
    current: List[str] = []
    length = 0
    for word in words:
        new_len = len(word) if not current else length + 1 + len(word)
        if current and new_len > max_chars:
            lines.append(" ".join(current))
            current = [word]
            length = len(word)
        else:
            current.append(word)
            length = new_len
    if current:
        lines.append(" ".join(current))
    if len(lines) <= max_lines:
        return lines
    kept = lines[: max_lines - 1]
    remaining = " ".join(lines[max_lines - 1 :])
    if len(remaining) > max_chars:
        remaining = remaining[: max(0, max_chars - 3)].rstrip() + "..."
    kept.append(remaining)
    return kept


def _ass_escape_line(line: str) -> str:
    # Escape ASS control characters per line.
    return line.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def _ass_escape(text: str) -> str:
    # Wrap and escape caption text for ASS.
    lines = _wrap_caption(text)
    if not lines:
        return ""
    escaped = [_ass_escape_line(line) for line in lines]
    return r"\N".join(escaped)


def _collect_entries(
    entries: Iterable[TranscriptEntry], start: float, end: float
) -> List[TranscriptEntry]:
    # Collect transcript entries overlapping the time window.
    selected: List[TranscriptEntry] = []
    for entry in entries:
        entry_end = entry.start + entry.duration
        if entry.start >= end or entry_end <= start:
            continue
        selected.append(entry)
    return selected


def _build_ass_subtitles(
    clip: ClipSpec,
    transcript: List[TranscriptEntry],
    output_path: Path,
) -> Optional[Path]:
    # Build ASS subtitles aligned to the concatenated clip timeline.
    events: List[str] = []
    offset = 0.0
    for segment in clip.segments:
        segment_duration = max(0.0, segment.end - segment.start)
        segment_entries = _collect_entries(transcript, segment.start, segment.end)
        if segment_entries:
            for entry in segment_entries:
                entry_start = max(segment.start, entry.start)
                entry_end = min(segment.end, entry.start + entry.duration)
                rel_start = offset + max(0.0, entry_start - segment.start)
                rel_end = offset + max(0.0, entry_end - segment.start)
                text = _ass_escape(entry.text)
                if not text:
                    continue
                events.append(
                    "Dialogue: 0,{start},{end},Default,,0,0,0,,{text}".format(
                        start=_format_ass_time(rel_start),
                        end=_format_ass_time(rel_end),
                        text=text,
                    )
                )
        elif segment.text:
            text = _ass_escape(segment.text)
            if text:
                events.append(
                    "Dialogue: 0,{start},{end},Default,,0,0,0,,{text}".format(
                        start=_format_ass_time(offset),
                        end=_format_ass_time(offset + segment_duration),
                        text=text,
                    )
                )
        offset += segment_duration
    if not events:
        return None
    header = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "WrapStyle: 2",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,DejaVu Sans,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,80,80,140,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    output_path.write_text("\n".join(header + events) + "\n", encoding="utf-8")
    return output_path


def _subtitle_filter(subtitle_path: Path) -> str:
    # Escape subtitle path for ffmpeg subtitles filter.
    value = str(subtitle_path).replace("\\", r"\\").replace(":", r"\:")
    return f"subtitles={value}"


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
    subtitle_path: Optional[Path],
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
    video_map = "[v]"
    if subtitle_path is not None:
        filters.append(f"[v]{_subtitle_filter(subtitle_path)}[vsub]")
        video_map = "[vsub]"
    args = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-filter_complex",
        ";".join(filters),
        "-map",
        video_map,
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


def render_clips(
    video_path: Path,
    output_dir: Path,
    clips: List[ClipSpec],
    transcript: Optional[List[TranscriptEntry]] = None,
) -> List[Path]:
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
        subtitle_path = None
        if transcript:
            subtitle_path = _build_ass_subtitles(
                clip,
                transcript,
                output_dir / f"clip_{clip.index:02d}.ass",
            )
        subtitles = _subtitle_filter(subtitle_path) if subtitle_path else None
        try:
            if len(clip.segments) == 1:
                segment = clip.segments[0]
                vf = crop_filter
                if subtitles:
                    vf = f"{vf},{subtitles}"
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
                    vf,
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
                    subtitle_path,
                )
        except RuntimeError:
            if len(clip.segments) == 1:
                segment = clip.segments[0]
                vf = crop_filter
                if subtitles:
                    vf = f"{vf},{subtitles}"
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
                    vf,
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
                    subtitle_path,
                )
        outputs.append(output_path)
    return outputs
