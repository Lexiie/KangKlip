from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, HttpUrl


class JobStatus(str, Enum):
    # Enumerates job states for API responses.
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class JobStage(str, Enum):
    # Enumerates worker stages to report progress.
    DOWNLOAD = "DOWNLOAD"
    TRANSCRIPT = "TRANSCRIPT"
    CHUNK = "CHUNK"
    SELECT = "SELECT"
    RENDER = "RENDER"
    UPLOAD = "UPLOAD"
    DONE = "DONE"


class JobCreateRequest(BaseModel):
    # Input schema for job creation.
    video_url: HttpUrl
    clip_duration_seconds: int = Field(..., ge=30, le=60)
    clip_count: int = Field(..., ge=1, le=5)
    language: str = Field("auto", pattern="^(en|id|auto)$")


class JobCreateResponse(BaseModel):
    # Response schema for job creation.
    job_id: str
    status: JobStatus


class JobStatusResponse(BaseModel):
    # Response schema for job status.
    job_id: str
    status: JobStatus
    stage: Optional[JobStage] = None
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    start_error: Optional[str] = None
    nosana_run_id: Optional[str] = None


class ClipResult(BaseModel):
    # Response schema for clip result entry.
    title: str
    duration: int
    download_url: str


class JobResultsResponse(BaseModel):
    # Response schema for job results.
    clips: List[ClipResult]


class CallbackRequest(BaseModel):
    # Payload schema for worker callbacks.
    job_id: str
    status: str  # Accept string, validate in endpoint
    r2_prefix: Optional[str] = None
    error: Optional[str] = None
