import json
from dataclasses import dataclass
from typing import Dict, List, Optional

import httpx

try:
    from .config import WorkerConfig
except ImportError as exc:
    if "attempted relative import" not in str(exc):
        raise
    from config import WorkerConfig


@dataclass
class SegmentSpec:
    # Represent a clip segment to stitch.
    start: float
    end: float
    text: str


@dataclass
class ClipSpec:
    # Represent a clip selection for rendering.
    index: int
    title: str
    hook: str
    segments: List[SegmentSpec]


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
        segments: List[SegmentSpec] = []
        segment_items = item.get("segments")
        if isinstance(segment_items, list) and segment_items:
            for seg in segment_items:
                if not isinstance(seg, dict):
                    continue
                if "candidate_id" in seg:
                    candidate_id = seg.get("candidate_id")
                    candidate = candidate_lookup.get(candidate_id)
                    if not candidate:
                        continue
                    segments.append(
                        SegmentSpec(
                            start=float(candidate["start"]),
                            end=float(candidate["end"]),
                            text=str(candidate.get("text", "")),
                        )
                    )
                    continue
                if "start" in seg and "end" in seg:
                    segments.append(
                        SegmentSpec(
                            start=float(seg["start"]),
                            end=float(seg["end"]),
                            text=str(seg.get("text", "")),
                        )
                    )
        else:
            candidate_id = item.get("candidate_id")
            candidate = candidate_lookup.get(candidate_id)
            if candidate:
                segments.append(
                    SegmentSpec(
                        start=float(candidate["start"]),
                        end=float(candidate["end"]),
                        text=str(candidate.get("text", "")),
                    )
                )
        if not segments:
            continue
        clips.append(
            ClipSpec(
                index=len(clips) + 1,
                title=str(item.get("title", "")),
                hook=str(item.get("hook", "")),
                segments=segments,
            )
        )
        if len(clips) >= clip_count:
            break

    clips.sort(key=lambda clip: clip.segments[0].start)

    validated = validate_clips(clips, clip_count, min_seconds, max_seconds)
    if len(validated) < clip_count:
        validated = _extend_with_heuristic(
            validated,
            candidates,
            clip_count,
            min_seconds,
            max_seconds,
        )
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
        "Each clip must include either candidate_id or segments (list of candidate_id). "
        f"job_id={job_id} language={language} clip_count={clip_count} "
        f"min_seconds={min_seconds} max_seconds={max_seconds}. "
        "Response schema: {\"selected\":[{\"title\":\"...\",\"hook\":\"...\",\"segments\":[{\"candidate_id\":\"c001\"}]}]} "
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
    clips = _extend_with_heuristic(
        [],
        candidates,
        clip_count,
        min_seconds,
        max_seconds,
    )
    return validate_clips(clips, clip_count, min_seconds, max_seconds)


def _extend_with_heuristic(
    current: List[ClipSpec],
    candidates: List[Dict[str, object]],
    clip_count: int,
    min_seconds: int,
    max_seconds: int,
    allow_overlap: bool = False,
) -> List[ClipSpec]:
    # Fill remaining slots with non-overlapping segments.
    clips = list(sorted(current, key=lambda clip: clip.segments[0].start))
    used = {
        (segment.start, segment.end)
        for clip in clips
        for segment in clip.segments
    }
    cursor = 0
    for clip in clips:
        clip.segments, cursor = _fill_segments(
            clip.segments,
            candidates,
            used,
            min_seconds,
            max_seconds,
            cursor,
            allow_overlap,
        )
        used.update((segment.start, segment.end) for segment in clip.segments)
    next_index = len(clips) + 1
    while len(clips) < clip_count:
        segments, cursor = _fill_segments(
            [],
            candidates,
            used,
            min_seconds,
            max_seconds,
            cursor,
            allow_overlap,
        )
        if not segments:
            if allow_overlap:
                break
            allow_overlap = True
            used = set()
            cursor = 0
            continue
        clips.append(
            ClipSpec(
                index=next_index,
                title=f"Clip {next_index}",
                hook=str(segments[0].text)[:120],
                segments=segments,
            )
        )
        used.update((segment.start, segment.end) for segment in segments)
        next_index += 1
    return clips


def _fill_segments(
    current: List[SegmentSpec],
    candidates: List[Dict[str, object]],
    used: set,
    min_seconds: int,
    max_seconds: int,
    cursor: int,
    allow_overlap: bool,
) -> tuple[List[SegmentSpec], int]:
    # Extend segments to reach target duration without overlap.
    segments = [
        segment
        for segment in sorted(current, key=lambda seg: seg.start)
        if segment.end > segment.start
    ]
    segments = _normalize_segments(segments, max_seconds)
    duration = sum(seg.end - seg.start for seg in segments)
    last_end = segments[-1].end if segments else -1.0
    idx = cursor
    while duration < max_seconds and idx < len(candidates):
        candidate = candidates[idx]
        idx += 1
        start = float(candidate["start"])
        end = float(candidate["end"])
        if not allow_overlap and (start, end) in used:
            continue
        if start < last_end:
            continue
        if end <= start:
            continue
        remaining = max_seconds - duration
        seg_end = min(end, start + remaining)
        if seg_end - start <= 0:
            continue
        segments.append(
            SegmentSpec(
                start=start,
                end=seg_end,
                text=str(candidate.get("text", "")),
            )
        )
        duration += seg_end - start
        last_end = seg_end
        if duration >= max_seconds:
            break
    if duration < min_seconds:
        return [], idx
    return _normalize_segments(segments, max_seconds), idx


def validate_clips(
    clips: List[ClipSpec],
    clip_count: int,
    min_seconds: int,
    max_seconds: int,
) -> List[ClipSpec]:
    # Validate clip boundaries, durations, and overlaps.
    sanitized: List[ClipSpec] = []
    for clip in clips:
        segments = _normalize_segments(list(clip.segments), max_seconds)
        total = sum(seg.end - seg.start for seg in segments)
        if total < min_seconds or total > max_seconds:
            continue
        if not segments:
            continue
        sanitized.append(
            ClipSpec(
                index=clip.index,
                title=clip.title,
                hook=clip.hook,
                segments=segments,
            )
        )
    sanitized.sort(key=lambda clip: clip.segments[0].start)
    return sanitized[:clip_count]


def reindex_clips(clips: List[ClipSpec]) -> List[ClipSpec]:
    # Reassign sequential indices to avoid duplicate output filenames.
    reindexed: List[ClipSpec] = []
    for idx, clip in enumerate(clips, start=1):
        title = clip.title
        prefix = "clip "
        if isinstance(title, str) and title.lower().startswith(prefix):
            suffix = title[len(prefix) :].strip()
            if not suffix or suffix.isdigit():
                title = f"Clip {idx}"
        reindexed.append(
            ClipSpec(
                index=idx,
                title=title,
                hook=clip.hook,
                segments=clip.segments,
            )
        )
    return reindexed


def _normalize_segments(segments: List[SegmentSpec], target_seconds: int) -> List[SegmentSpec]:
    # Normalize segments to be ordered, non-overlapping, and within target duration.
    normalized: List[SegmentSpec] = []
    last_end = -1.0
    remaining = float(target_seconds)
    for segment in sorted(segments, key=lambda seg: seg.start):
        if segment.end <= segment.start:
            continue
        if segment.start < last_end:
            continue
        if remaining <= 0:
            break
        seg_len = segment.end - segment.start
        if seg_len > remaining:
            seg_end = segment.start + remaining
        else:
            seg_end = segment.end
        normalized.append(
            SegmentSpec(
                start=segment.start,
                end=seg_end,
                text=segment.text,
            )
        )
        remaining -= seg_end - segment.start
        last_end = seg_end
    return normalized


def build_manifest(job_id: str, clips: List[ClipSpec]) -> Dict[str, object]:
    # Build manifest content for uploads.
    return {
        "job_id": job_id,
        "clips": [
            {
                "index": clip.index,
                "title": clip.title,
                "hook": clip.hook,
                "start": clip.segments[0].start,
                "end": clip.segments[-1].end,
                "duration": int(sum(seg.end - seg.start for seg in clip.segments)),
                "segments": [
                    {
                        "start": seg.start,
                        "end": seg.end,
                        "text": seg.text,
                    }
                    for seg in clip.segments
                ],
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
                "segments": [
                    {
                        "start": seg.start,
                        "end": seg.end,
                        "text": seg.text,
                    }
                    for seg in clip.segments
                ],
            }
            for clip in clips
        ],
    }
