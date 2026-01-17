from pathlib import Path
import json
import subprocess
from typing import Dict, Iterable, List, Optional, Tuple

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


def _probe_video_info(video_path: Path) -> Tuple[int, int, int, int, int]:
    # Get source video dimensions and rotation metadata.
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:stream_tags=rotate:side_data_list",
        "-of",
        "json",
        str(video_path),
    ]
    result = subprocess.run(
        cmd,
        check=True,
        capture_output=True,
        text=True,
    )
    if result.stderr:
        print(f"ffprobe warning: {result.stderr.strip()}")
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    if not streams:
        raise RuntimeError("Unable to probe video dimensions")
    stream = streams[0]
    width = int(stream.get("width", 0))
    height = int(stream.get("height", 0))
    if width <= 0 or height <= 0:
        raise RuntimeError("Invalid video dimensions")
    rotation = _extract_rotation(stream)
    display_width, display_height = width, height
    if rotation in (90, 270):
        display_width, display_height = height, width
    return width, height, display_width, display_height, rotation


def _extract_rotation(stream: Dict[str, object]) -> int:
    # Extract rotation metadata if present.
    tags = stream.get("tags") or {}
    rotate_tag = tags.get("rotate") if isinstance(tags, dict) else None
    rotation = 0
    if rotate_tag is not None:
        try:
            rotation = int(rotate_tag)
        except (TypeError, ValueError):
            rotation = 0
    if rotation:
        return rotation % 360
    side_data = stream.get("side_data_list") or []
    if isinstance(side_data, list):
        for item in side_data:
            if not isinstance(item, dict):
                continue
            value = item.get("rotation")
            if value is None:
                continue
            try:
                return int(value) % 360
            except (TypeError, ValueError):
                continue
    return 0


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _rotation_filter(rotation: int) -> str:
    # Build a rotation filter for display orientation.
    if rotation == 90:
        return "transpose=1"
    if rotation == 180:
        return "transpose=2,transpose=2"
    if rotation == 270:
        return "transpose=2"
    return ""


def _build_crop_filter(
    width: int,
    height: int,
    face_center: Optional[Tuple[float, float]],
    rotation: int,
) -> str:
    # Build a 9:16 crop that keeps the face in frame when available.
    target_ratio = 9 / 16
    source_ratio = width / height
    if source_ratio >= target_ratio:
        crop_h = height
        crop_w = int(round(height * target_ratio))
        center_x = face_center[0] if face_center else width / 2
        max_x = max(0, width - crop_w)
        crop_x = int(round(_clamp(center_x - crop_w / 2, 0, max_x)))
        crop_y = 0
    else:
        crop_w = width
        crop_h = int(round(width / target_ratio))
        center_y = face_center[1] if face_center else height / 2
        max_y = max(0, height - crop_h)
        crop_x = 0
        crop_y = int(round(_clamp(center_y - crop_h / 2, 0, max_y)))
    rotate = _rotation_filter(rotation)
    crop = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale=1080:1920:flags=lanczos"
    if rotate:
        return f"{rotate},{crop}"
    return crop


def _format_ass_time(seconds: float) -> str:
    # Format seconds into ASS timestamp (H:MM:SS.cc).
    total_cs = max(0, int(round(seconds * 100)))
    hours = total_cs // 360000
    minutes = (total_cs % 360000) // 6000
    secs = (total_cs % 6000) // 100
    centis = total_cs % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def _wrap_caption(text: str, max_chars: int = 24, max_lines: int = 2) -> List[List[str]]:
    # Wrap caption words into short lines to fit 9:16 safely.
    words = [word for word in text.replace("\n", " ").split(" ") if word]
    if not words:
        return []
    lines: List[List[str]] = []
    current: List[str] = []
    length = 0
    for word in words:
        new_len = len(word) if not current else length + 1 + len(word)
        if current and new_len > max_chars:
            lines.append(current)
            current = [word]
            length = len(word)
        else:
            current.append(word)
            length = new_len
    if current:
        lines.append(current)
    if len(lines) <= max_lines:
        return lines
    kept = lines[: max_lines - 1]
    remaining = [word for line in lines[max_lines - 1 :] for word in line]
    if remaining:
        kept.append(remaining)
    return kept


def _ass_escape_line(line: str) -> str:
    # Escape ASS control characters per line.
    return line.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def _ass_escape(text: str) -> str:
    # Escape caption text for ASS.
    return _ass_escape_line(text)


def _build_karaoke_text(
    text: str,
    duration: float,
    max_chars: int = 24,
    max_lines: int = 2,
) -> str:
    # Build karaoke ASS text with per-word timing.
    lines = _wrap_caption(text, max_chars=max_chars, max_lines=max_lines)
    if not lines:
        return ""
    words = [word for line in lines for word in line]
    if not words:
        return ""
    total_cs = max(1, int(round(duration * 100)))
    if total_cs <= len(words):
        allocations = [1] * total_cs + [0] * (len(words) - total_cs)
    else:
        weights = [max(1, len(word)) for word in words]
        weight_sum = sum(weights)
        allocations = [max(1, int(round(total_cs * (w / weight_sum)))) for w in weights]
        delta = total_cs - sum(allocations)
        idx = 0
        guard = 0
        while delta != 0 and allocations and guard < len(allocations) * 4:
            if delta > 0:
                allocations[idx] += 1
                delta -= 1
            else:
                if allocations[idx] > 1:
                    allocations[idx] -= 1
                    delta += 1
            idx = (idx + 1) % len(allocations)
            guard += 1
    chunks: List[str] = []
    word_index = 0
    for line in lines:
        line_parts: List[str] = []
        for word in line:
            duration_cs = allocations[word_index]
            word_index += 1
            line_parts.append(f"{{\\k{duration_cs}}}{_ass_escape(word)}")
        chunks.append(" ".join(line_parts))
    return r"\N".join(chunks)


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
    last_end = 0.0
    offset = 0.0
    for segment in clip.segments:
        segment_duration = max(0.0, segment.end - segment.start)
        segment_entries = _collect_entries(transcript, segment.start, segment.end)
        segment_entries.sort(key=lambda entry: entry.start)
        if segment_entries:
            for entry in segment_entries:
                entry_start = max(segment.start, entry.start)
                entry_end = min(segment.end, entry.start + entry.duration)
                rel_start = offset + max(0.0, entry_start - segment.start)
                rel_end = offset + max(0.0, entry_end - segment.start)
                if rel_start < last_end:
                    rel_start = last_end
                if rel_end <= rel_start:
                    continue
                text = _build_karaoke_text(entry.text, rel_end - rel_start)
                if not text:
                    continue
                events.append(
                    "Dialogue: 0,{start},{end},Default,,0,0,0,,{text}".format(
                        start=_format_ass_time(rel_start),
                        end=_format_ass_time(rel_end),
                        text="{\\fad(60,60)\\t(0,180,\\fscx105\\fscy105)\\t(180,260,\\fscx100\\fscy100)}"
                        + text,
                    )
                )
                last_end = rel_end
        elif segment.text:
            rel_start = max(offset, last_end)
            rel_end = offset + segment_duration
            if rel_end <= rel_start:
                offset += segment_duration
                continue
            text = _build_karaoke_text(segment.text, rel_end - rel_start)
            if text:
                events.append(
                    "Dialogue: 0,{start},{end},Default,,0,0,0,,{text}".format(
                        start=_format_ass_time(rel_start),
                        end=_format_ass_time(rel_end),
                        text="{\\fad(60,60)\\t(0,180,\\fscx105\\fscy105)\\t(180,260,\\fscx100\\fscy100)}"
                        + text,
                    )
                )
                last_end = rel_end
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
        "Style: Default,DejaVu Sans,80,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,150,1",
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
    crop_filters: List[str],
    clip: ClipSpec,
    video_codec: str,
    preset: str,
    has_audio: bool,
    subtitle_path: Optional[Path],
    use_manual_rotation: bool,
) -> None:
    # Render a multi-segment clip with ffmpeg concat filter.
    filters: List[str] = []
    for idx, segment in enumerate(clip.segments):
        v_label = f"v{idx}"
        crop_filter = crop_filters[idx]
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
        filters.append("[a]loudnorm=I=-16:TP=-1.5:LRA=11[an]")
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
    ]
    if use_manual_rotation:
        args.append("-noautorotate")
    args += [
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
    if use_manual_rotation:
        args += ["-metadata:s:v:0", "rotate=0"]
    if has_audio:
        args += ["-map", "[an]", "-c:a", "aac"]
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
    legacy_crop_filter = (
        "crop="
        "if(gte(iw/ih\\,9/16)\\,ih*9/16\\,iw):"
        "if(gte(iw/ih\\,9/16)\\,ih\\,iw*16/9),"
        "scale=1080:1920:flags=lanczos"
    )
    use_manual_rotation = True
    rotation = 0
    display_width = 0
    display_height = 0
    face_centers: Dict[int, List[Optional[Tuple[float, float]]]] = {}
    face_meta: Dict[str, object] = {"backend": "unavailable", "reason": "ffprobe_failed"}
    try:
        _width, _height, display_width, display_height, rotation = _probe_video_info(video_path)
        face_centers, face_meta = _find_face_centers(video_path, clips, rotation)
    except Exception:
        use_manual_rotation = False
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
        if use_manual_rotation:
            crop_filters = _build_clip_crop_filters(
                display_width,
                display_height,
                clip,
                face_centers.get(clip.index),
                rotation,
            )
        else:
            crop_filters = [legacy_crop_filter for _ in clip.segments]
        try:
            if len(clip.segments) == 1:
                segment = clip.segments[0]
                vf = crop_filters[0]
                if subtitles:
                    vf = f"{vf},{subtitles}"
                args = [
                    "ffmpeg",
                    "-y",
                ]
                if use_manual_rotation:
                    args.append("-noautorotate")
                args += [
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
                if use_manual_rotation:
                    args += ["-metadata:s:v:0", "rotate=0"]
                if has_audio:
                    args += ["-c:a", "aac", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
                else:
                    args += ["-an"]
                args.append(str(output_path))
                run_cmd(args)
            else:
                _render_montage(
                    video_path,
                    output_path,
                    crop_filters,
                    clip,
                    video_codec,
                    preset,
                    has_audio,
                    subtitle_path,
                    use_manual_rotation,
                )
        except RuntimeError:
            if len(clip.segments) == 1:
                segment = clip.segments[0]
                vf = crop_filters[0]
                if subtitles:
                    vf = f"{vf},{subtitles}"
                args = [
                    "ffmpeg",
                    "-y",
                ]
                if use_manual_rotation:
                    args.append("-noautorotate")
                args += [
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
                if use_manual_rotation:
                    args += ["-metadata:s:v:0", "rotate=0"]
                if has_audio:
                    args += ["-c:a", "aac", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
                else:
                    args += ["-an"]
                args.append(str(output_path))
                run_cmd(args)
            else:
                _render_montage(
                    video_path,
                    output_path,
                    crop_filters,
                    clip,
                    "libx264",
                    "veryfast",
                    has_audio,
                    subtitle_path,
                    use_manual_rotation,
                )
        outputs.append(output_path)
    try:
        face_log = {
            "backend": face_meta.get("backend"),
            "reason": face_meta.get("reason"),
            "clips": [
                {
                    "index": clip.index,
                    "segments": len(clip.segments),
                    "detected": sum(
                        1
                        for center in (face_centers.get(clip.index) or [])
                        if center is not None
                    ),
                }
                for clip in clips
            ],
        }
        (output_dir / "face_log.json").write_text(
            json.dumps(face_log), encoding="utf-8"
        )
    except Exception:
        pass
    return outputs


def _find_face_centers(
    video_path: Path,
    clips: List[ClipSpec],
    rotation: int,
) -> Tuple[Dict[int, List[Optional[Tuple[float, float]]]], Dict[str, object]]:
    # Detect face centers for each segment using OpenCV DNN (CUDA when available).
    try:
        import cv2
    except Exception:
        print("face detect: opencv unavailable, fallback to center crop")
        return (
            {clip.index: [None for _ in clip.segments] for clip in clips},
            {"backend": "unavailable", "reason": "opencv_missing"},
        )

    model_dir = Path("/app/models/face")
    prototxt = model_dir / "opencv_face_detector.pbtxt"
    weights = model_dir / "opencv_face_detector_uint8.pb"
    if not prototxt.exists() or not weights.exists():
        print("face detect: model files missing, fallback to center crop")
        return (
            {clip.index: [None for _ in clip.segments] for clip in clips},
            {"backend": "unavailable", "reason": "model_missing"},
        )

    net = cv2.dnn.readNetFromTensorflow(str(weights), str(prototxt))
    try:
        if hasattr(cv2, "cuda") and cv2.cuda.getCudaEnabledDeviceCount() > 0:
            net.setPreferableBackend(cv2.dnn.DNN_BACKEND_CUDA)
            net.setPreferableTarget(cv2.dnn.DNN_TARGET_CUDA_FP16)
    except Exception:
        pass

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        print("face detect: failed to open video, fallback to center crop")
        return (
            {clip.index: [None for _ in clip.segments] for clip in clips},
            {"backend": "unavailable", "reason": "video_open_failed"},
        )

    def rotate_frame(frame):
        if rotation == 90:
            return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
        if rotation == 180:
            return cv2.rotate(frame, cv2.ROTATE_180)
        if rotation == 270:
            return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
        return frame

    def detect_center(frame) -> Optional[Tuple[float, float]]:
        frame = rotate_frame(frame)
        height, width = frame.shape[:2]
        blob = cv2.dnn.blobFromImage(
            frame,
            scalefactor=1.0,
            size=(300, 300),
            mean=(104.0, 177.0, 123.0),
            swapRB=True,
        )
        net.setInput(blob)
        detections = net.forward()
        best = None
        best_area = 0.0
        for i in range(detections.shape[2]):
            confidence = float(detections[0, 0, i, 2])
            if confidence < 0.5:
                continue
            box = detections[0, 0, i, 3:7]
            x1 = int(box[0] * width)
            y1 = int(box[1] * height)
            x2 = int(box[2] * width)
            y2 = int(box[3] * height)
            x1 = max(0, min(width - 1, x1))
            y1 = max(0, min(height - 1, y1))
            x2 = max(0, min(width - 1, x2))
            y2 = max(0, min(height - 1, y2))
            if x2 <= x1 or y2 <= y1:
                continue
            area = (x2 - x1) * (y2 - y1)
            if area > best_area:
                best_area = area
                best = ((x1 + x2) / 2, (y1 + y2) / 2)
        return best

    centers: Dict[int, List[Optional[Tuple[float, float]]]] = {}
    for clip in clips:
        clip_centers: List[Optional[Tuple[float, float]]] = []
        detected = 0
        for segment in clip.segments:
            duration = max(0.0, segment.end - segment.start)
            if duration <= 0:
                clip_centers.append(None)
                continue
            sample_count = min(20, max(4, int(duration * 2)))
            step = duration / sample_count
            samples: List[Tuple[float, float]] = []
            for idx in range(sample_count):
                timestamp = segment.start + idx * step
                capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
                ok, frame = capture.read()
                if not ok:
                    continue
                center = detect_center(frame)
                if center:
                    samples.append(center)
            if samples:
                xs = sorted(point[0] for point in samples)
                ys = sorted(point[1] for point in samples)
                mid = len(samples) // 2
                clip_centers.append((xs[mid], ys[mid]))
                detected += 1
            else:
                clip_centers.append(None)
        print(f"face detect: clip {clip.index} segments {len(clip.segments)} detected {detected}")
        centers[clip.index] = clip_centers
    capture.release()
    return centers, {"backend": "opencv-dnn"}


def _build_clip_crop_filters(
    width: int,
    height: int,
    clip: ClipSpec,
    centers: Optional[List[Optional[Tuple[float, float]]]],
    rotation: int,
) -> List[str]:
    # Build per-segment crop filters using detected face centers.
    filters: List[str] = []
    for idx, _segment in enumerate(clip.segments):
        center = None
        if centers and idx < len(centers):
            center = centers[idx]
        filters.append(_build_crop_filter(width, height, center, rotation))
    return filters
