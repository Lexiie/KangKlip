import json
from dataclasses import dataclass
from typing import Dict, List, Optional

import httpx

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
    # Select clip segments using external LLM API, fallback to heuristic.
    candidates = build_candidates(chunks, min_seconds, max_seconds)
    if not candidates:
        _set_selection("heuristic", config.llm_api_base)
        return heuristic_select(chunks, clip_count, min_seconds, max_seconds)
    try:
        selected = _call_gemini(config, candidates, clip_count, min_seconds, max_seconds)
    except (httpx.HTTPError, json.JSONDecodeError, ValueError, RuntimeError):
        _set_selection("heuristic", config.llm_api_base)
        return heuristic_select(chunks, clip_count, min_seconds, max_seconds)

    candidate_lookup = {candidate["id"]: candidate for candidate in candidates}
    clips: List[ClipSpec] = []
    for item in selected:
        candidate_id = item.get("candidate_id")
        if not candidate_id or candidate_id not in candidate_lookup:
            continue
        candidate = candidate_lookup[candidate_id]
        clips.append(
            ClipSpec(
                index=len(clips) + 1,
                title=str(item.get("title", "")),
                hook=str(item.get("hook", "")),
                start=float(candidate["start"]),
                end=float(candidate["end"]),
            )
        )
        if len(clips) >= clip_count:
            break

    clips.sort(key=lambda clip: clip.start)

    validated = validate_clips(clips, clip_count, min_seconds, max_seconds)
    if len(validated) < clip_count:
        fallback = heuristic_select(chunks, clip_count, min_seconds, max_seconds)
        merged = validated + [clip for clip in fallback if clip not in validated]
        merged.sort(key=lambda clip: clip.start)
        validated = validate_clips(merged, clip_count, min_seconds, max_seconds)
    if validated:
        validated = reindex_clips(validated)
        _set_selection("llm_api", _build_endpoint(config))
        return validated
    _set_selection("heuristic", config.llm_api_base)
    return heuristic_select(chunks, clip_count, min_seconds, max_seconds)


_LAST_SELECTION: Dict[str, Optional[str]] = {"mode": None, "endpoint": None}


def get_last_selection() -> Dict[str, Optional[str]]:
    # Return last selection metadata for manifest.
    return {"mode": _LAST_SELECTION.get("mode"), "endpoint": _LAST_SELECTION.get("endpoint")}


def _set_selection(mode: str, endpoint: str) -> None:
    # Store selection metadata for downstream manifest.
    _LAST_SELECTION["mode"] = mode
    _LAST_SELECTION["endpoint"] = endpoint


def build_candidates(
    chunks: List[Dict[str, float]],
    min_seconds: int,
    max_seconds: int,
) -> List[Dict[str, object]]:
    # Build deterministic candidate windows from transcript chunks.
    candidates: List[Dict[str, object]] = []
    for idx, chunk in enumerate(chunks, start=1):
        start = float(chunk["start"])
        end = min(float(chunk["end"]), start + max_seconds)
        if end - start < min_seconds:
            end = start + min_seconds
        candidates.append(
            {
                "id": f"c{idx:03d}",
                "start": start,
                "end": end,
                "text": str(chunk.get("text", "")),
            }
        )
    return candidates


def _build_endpoint(config: WorkerConfig) -> str:
    # Build Gemini API endpoint URL.
    base = config.llm_api_base.rstrip("/")
    return f"{base}/v1beta/models/{config.llm_model_name}:generateContent"


def _call_gemini(
    config: WorkerConfig,
    candidates: List[Dict[str, object]],
    clip_count: int,
    min_seconds: int,
    max_seconds: int,
) -> List[Dict[str, object]]:
    # Call Gemini API to select candidate clips.
    endpoint = _build_endpoint(config)
    headers = {"Content-Type": "application/json"}
    prompt = _build_prompt(
        config.job_id,
        config.language,
        clip_count,
        min_seconds,
        max_seconds,
        candidates,
    )
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ]
    }
    url = endpoint
    if config.llm_api_key:
        url = f"{endpoint}?key={config.llm_api_key}"
    response = httpx.post(url, json=payload, headers=headers, timeout=config.llm_timeout_seconds)
    response.raise_for_status()
    data = response.json()
    text = _extract_text(data)
    parsed = json.loads(_extract_json(text))
    return parsed.get("selected", [])


def _build_prompt(
    job_id: str,
    language: str,
    clip_count: int,
    min_seconds: int,
    max_seconds: int,
    candidates: List[Dict[str, object]],
) -> str:
    # Build deterministic prompt for rerank selection.
    return (
        "Select highlight clips from candidates. Return JSON only. "
        "Use only candidate_id from the list. "
        f"job_id={job_id} language={language} clip_count={clip_count} "
        f"min_seconds={min_seconds} max_seconds={max_seconds}. "
        "Response schema: {\"selected\":[{\"candidate_id\":\"c001\",\"title\":\"...\",\"hook\":\"...\",\"score\":0.0}]} "
        "Candidates: "
        + json.dumps(candidates)
    )


def _extract_text(payload: Dict[str, object]) -> str:
    # Extract text output from Gemini response.
    candidates = payload.get("candidates")
    if not candidates:
        raise RuntimeError("LLM response missing candidates")
    content = candidates[0].get("content", {})
    parts = content.get("parts", [])
    if not parts:
        raise RuntimeError("LLM response missing parts")
    text = parts[0].get("text")
    if not text:
        raise RuntimeError("LLM response missing text")
    return str(text)


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
    candidates = build_candidates(chunks, min_seconds, max_seconds)
    for idx, candidate in enumerate(candidates[:clip_count], start=1):
        start = float(candidate["start"])
        end = float(candidate["end"])
        if end - start < min_seconds:
            end = start + min_seconds
        clips.append(
            ClipSpec(
                index=idx,
                title=f"Clip {idx}",
                hook=str(candidate.get("text", ""))[:120],
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


def reindex_clips(clips: List[ClipSpec]) -> List[ClipSpec]:
    # Reassign sequential indices to avoid duplicate output filenames.
    reindexed: List[ClipSpec] = []
    for idx, clip in enumerate(clips, start=1):
        reindexed.append(
            ClipSpec(
                index=idx,
                title=clip.title,
                hook=clip.hook,
                start=clip.start,
                end=clip.end,
            )
        )
    return reindexed


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
