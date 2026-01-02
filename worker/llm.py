import json
from dataclasses import dataclass
from typing import Dict, List, Optional

from .config import WorkerConfig


@dataclass
class ClipSpec:
    # Represent a clip selection for rendering.
    index: int
    title: str
    hook: str
    start: float
    end: float


def llm_select_segments(
    config: WorkerConfig,
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
    llm = LLM(
        model=config.llm_model,
        dtype="auto",
        max_model_len=config.llm_context_tokens,
        quantization=config.llm_quantization,
        gpu_memory_utilization=config.llm_gpu_memory_util,
    )
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


def clip_to_edl(job_id: str, clips: List[ClipSpec]) -> Dict[str, object]:
    # Build the EDL structure for downstream inspection.
    return {
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
