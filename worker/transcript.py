from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

from .io_utils import run_cmd


@dataclass
class TranscriptEntry:
    # Represent a transcript segment with timing.
    text: str
    start: float
    duration: float


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
