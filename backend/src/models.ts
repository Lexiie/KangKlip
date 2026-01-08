export const JOB_STATUS = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
} as const;

export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

export const JOB_STAGE = {
  DOWNLOAD: "DOWNLOAD",
  TRANSCRIPT: "TRANSCRIPT",
  CHUNK: "CHUNK",
  SELECT: "SELECT",
  RENDER: "RENDER",
  UPLOAD: "UPLOAD",
  DONE: "DONE",
} as const;

export type JobStage = (typeof JOB_STAGE)[keyof typeof JOB_STAGE];

export type JobCreateRequest = {
  video_url: string;
  clip_duration_seconds: number;
  clip_count: number;
  language: string;
};

export type CallbackRequest = {
  job_id: string;
  status: JobStatus;
  r2_prefix?: string;
  error?: string;
};

export const isValidJobId = (jobId: string): boolean => {
  return /^kk_[0-9A-HJKMNP-TV-Z]{26}$/.test(jobId);
};

export const validateJobCreate = (body: Partial<JobCreateRequest>): string | null => {
  if (!body.video_url || typeof body.video_url !== "string") {
    return "video_url is required";
  }
  try {
    new URL(body.video_url);
  } catch {
    return "video_url must be a valid URL";
  }
  if (typeof body.clip_duration_seconds !== "number") {
    return "clip_duration_seconds is required";
  }
  if (body.clip_duration_seconds < 30 || body.clip_duration_seconds > 60) {
    return "clip_duration_seconds must be between 30 and 60";
  }
  if (typeof body.clip_count !== "number") {
    return "clip_count is required";
  }
  if (body.clip_count < 1 || body.clip_count > 5) {
    return "clip_count must be between 1 and 5";
  }
  const lang = body.language ?? "auto";
  if (![/^en$/, /^id$/, /^auto$/].some((re) => re.test(lang))) {
    return "language must be en, id, or auto";
  }
  return null;
};
