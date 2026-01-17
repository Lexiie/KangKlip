from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

@dataclass
class TranscriptEntry:
    # Represent a transcript segment with timing.
    text: str
    start: float
    duration: float
    words: List[Dict[str, float | str]]


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
                    TranscriptEntry(
                        text=text,
                        start=start,
                        duration=max(0.0, end - start),
                        words=[],
                    )
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


def transcribe_audio(audio_path: Path, language: str, asr_model: str) -> List[TranscriptEntry]:
    # Run faster-whisper ASR to generate transcript entries.
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        raise RuntimeError("faster-whisper is not available") from exc
    model = WhisperModel(asr_model, device="cuda", compute_type="int8")
    segments, info = model.transcribe(
        str(audio_path),
        language=None if language == "auto" else language,
        vad_filter=True,
        temperature=0,
        condition_on_previous_text=False,
        word_timestamps=True,
    )
    if language == "auto" and info is not None:
        detected = getattr(info, "language", None)
        prob = getattr(info, "language_probability", None)
        if detected:
            if prob is not None:
                print(f"asr detected language={detected} prob={prob:.2f}")
            else:
                print(f"asr detected language={detected}")
            if detected in {"id", "en"}:
                segments, _ = model.transcribe(
                    str(audio_path),
                    language=detected,
                    vad_filter=True,
                    temperature=0,
                    condition_on_previous_text=False,
                    word_timestamps=True,
                )
    entries: List[TranscriptEntry] = []
    for segment in segments:
        words: List[Dict[str, float | str]] = []
        for word in getattr(segment, "words", []) or []:
            word_text = str(getattr(word, "word", "")).strip()
            if not word_text:
                continue
            words.append(
                {
                    "word": word_text,
                    "start": float(getattr(word, "start", segment.start)),
                    "end": float(getattr(word, "end", segment.end)),
                }
            )
        entries.append(
            TranscriptEntry(
                text=segment.text.strip(),
                start=segment.start,
                duration=segment.end - segment.start,
                words=words,
            )
        )
    _apply_auto_punctuation(entries)
    return entries


def _apply_auto_punctuation(entries: List[TranscriptEntry]) -> None:
    # Apply lightweight punctuation to ASR output.
    for idx, entry in enumerate(entries):
        text = entry.text.strip()
        if not text:
            continue
        if text[0].isalpha():
            text = text[0].upper() + text[1:]
            if entry.words:
                first = entry.words[0].get("word")
                if isinstance(first, str) and first:
                    entry.words[0]["word"] = first[0].upper() + first[1:]
        punct = text[-1]
        if punct not in ".?!":
            gap = None
            if idx + 1 < len(entries):
                next_start = entries[idx + 1].start
                gap = max(0.0, next_start - (entry.start + entry.duration))
            if gap is not None and gap > 0.8:
                text = f"{text}."
                if entry.words:
                    last = entry.words[-1].get("word")
                    if isinstance(last, str) and last:
                        entry.words[-1]["word"] = last + "."
        entry.text = text


def chunk_transcript(entries: List[TranscriptEntry]) -> List[Dict[str, float]]:
    # Merge transcript entries into ~5 minute chunks.
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
        if buffer_start is not None and buffer_end is not None and buffer_end - buffer_start >= 300.0:
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
