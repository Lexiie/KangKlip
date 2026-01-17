import cors from "cors";
import express from "express";
import { Readable } from "stream";
import { ulid } from "ulid";
import { getConfig } from "./config.js";
import { JobStore } from "./storage.js";
import {
  JOB_STATUS,
  JOB_STAGE,
  CallbackRequest,
  isValidJobId,
  validateJobCreate,
} from "./models.js";
import { createDeployment, createNosanaClient, fetchMarketCache, startDeployment } from "./nosana.js";
import { getObjectStream, loadManifest, signClipUrls } from "./r2.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: false,
  })
);

const config = getConfig();
const store = new JobStore(config.redisUrl);
await store.connect();
const nosana = createNosanaClient(config);

const buildJobId = () => `kk_${ulid()}`;
const buildCallbackUrl = (base: string) => `${base.replace(/\/$/, "")}/api/callback/nosana`;

const buildWorkerEnv = (
  jobId: string,
  body: { clip_duration_seconds: number; clip_count: number; language: string; video_url: string }
) => {
  const clipSeconds = String(body.clip_duration_seconds);
  const env: Record<string, string> = {
    JOB_ID: jobId,
    VIDEO_URL: body.video_url,
    CLIP_COUNT: String(body.clip_count),
    MIN_CLIP_SECONDS: clipSeconds,
    MAX_CLIP_SECONDS: clipSeconds,
    OUTPUT_LANGUAGE: body.language,
    TRANSCRIPT_MODE: "prefer_existing",
    ASR_FALLBACK: "true",
    ASR_MODEL: "small",
    R2_ENDPOINT: config.r2Endpoint,
    R2_BUCKET: config.r2Bucket,
    R2_ACCESS_KEY_ID: config.r2AccessKeyId,
    R2_SECRET_ACCESS_KEY: config.r2SecretAccessKey,
    LLM_API_BASE: config.llmApiBase,
    LLM_TIMEOUT_SECONDS: "20",
    LLM_MODEL_NAME: config.llmModelName,
    CALLBACK_URL: buildCallbackUrl(config.callbackBaseUrl),
    R2_PREFIX: `jobs/${jobId}/`,
  };
  if (config.llmApiKey) {
    env.LLM_API_KEY = config.llmApiKey;
  }
  return env;
};

app.post("/api/jobs", async (req, res) => {
  const error = validateJobCreate(req.body ?? {});
  if (error) {
    return res.status(400).json({ detail: error });
  }
  const payload = req.body as {
    video_url: string;
    clip_duration_seconds: number;
    clip_count: number;
    language: string;
  };
  const jobId = buildJobId();
  await store.set(jobId, {
    job_id: jobId,
    status: JOB_STATUS.QUEUED,
    stage: JOB_STAGE.DOWNLOAD,
    progress: 0,
  });

  try {
    const cacheInfo = await fetchMarketCache(config);
    await store.update(jobId, { market_cache: cacheInfo });
  } catch {
    // ignore cache check failure
  }

  let deploymentId: string;
  try {
    const deployment = await createDeployment(nosana, config, jobId, buildWorkerEnv(jobId, payload));
    deploymentId = deployment.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.update(jobId, { status: JOB_STATUS.FAILED, error: message });
    return res.status(502).json({ detail: message });
  }

  await store.update(jobId, { nosana_run_id: deploymentId });

  setTimeout(async () => {
    const startError = await startDeployment(nosana, deploymentId);
    if (startError) {
      await store.update(jobId, { start_error: startError });
    }
  }, 0);

  return res.json({ job_id: jobId, status: JOB_STATUS.QUEUED });
});

app.get("/api/jobs/:jobId", async (req, res) => {
  const jobId = req.params.jobId;
  const data = await store.get(jobId);
  if (!data) {
    return res.status(404).json({ detail: "job not found" });
  }
  return res.json({
    job_id: jobId,
    status: data.status ?? JOB_STATUS.QUEUED,
    stage: data.stage ?? null,
    progress: data.progress ?? null,
    start_error: data.start_error ?? null,
    nosana_run_id: data.nosana_run_id ?? null,
  });
});

app.post("/api/jobs/:jobId/start", async (req, res) => {
  const jobId = req.params.jobId;
  const data = await store.get(jobId);
  if (!data) {
    return res.status(404).json({ detail: "job not found" });
  }
  const runId = data.nosana_run_id as string | undefined;
  if (!runId) {
    return res.status(409).json({ detail: "nosana run id missing" });
  }
  const startError = await startDeployment(nosana, runId);
  if (startError) {
    await store.update(jobId, { start_error: startError });
    return res.json({ ok: false, start_error: startError });
  }
  await store.update(jobId, { start_error: null });
  return res.json({ ok: true });
});

app.get("/api/jobs/:jobId/results", async (req, res) => {
  const jobId = req.params.jobId;
  const data = await store.get(jobId);
  if (!data) {
    return res.status(404).json({ detail: "job not found" });
  }
  if (data.status !== JOB_STATUS.SUCCEEDED) {
    return res.status(409).json({ detail: "job not completed" });
  }
  const r2Prefix = data.r2_prefix as string | undefined;
  if (!r2Prefix) {
    return res.status(500).json({ detail: "missing r2 prefix" });
  }
  try {
    const manifest = await loadManifest(config, r2Prefix);
    const clips = (manifest.clips as Array<Record<string, unknown>>) || [];
    const clipFiles = clips.map((clip) => String(clip.file ?? ""));
    const urls = await signClipUrls(config, r2Prefix, clipFiles);
    const results = clips.map((clip, index) => ({
      file: String(clip.file ?? ""),
      title: String(clip.title ?? ""),
      duration: Number(clip.duration ?? 0),
      download_url: urls[index],
      stream_url: `/api/jobs/${jobId}/clips/${String(clip.file ?? "")}`,
    }));
    return res.json({ clips: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ detail: message });
  }
});

const streamClip = async (
  req: express.Request,
  res: express.Response,
  options?: { attachment?: boolean }
) => {
  const jobId = req.params.jobId;
  const clipFile = req.params.clipFile;
  const data = await store.get(jobId);
  if (!data) {
    return res.status(404).json({ detail: "job not found" });
  }
  if (data.status !== JOB_STATUS.SUCCEEDED) {
    return res.status(409).json({ detail: "job not completed" });
  }
  const r2Prefix = data.r2_prefix as string | undefined;
  if (!r2Prefix) {
    return res.status(500).json({ detail: "missing r2 prefix" });
  }
  try {
    const manifest = await loadManifest(config, r2Prefix);
    const clips = (manifest.clips as Array<Record<string, unknown>>) || [];
    const allowed = new Set(clips.map((clip) => String(clip.file ?? "")));
    if (!allowed.has(clipFile)) {
      return res.status(404).json({ detail: "clip not found" });
    }
    const key = `${r2Prefix.replace(/\/+$/, "")}/${clipFile}`;
    const range = req.headers.range;
    const response = await getObjectStream(config, key, range);
    if (!response.Body) {
      return res.status(502).json({ detail: "missing clip body" });
    }
    if (response.ContentType) {
      res.setHeader("Content-Type", response.ContentType);
    } else {
      res.setHeader("Content-Type", "video/mp4");
    }
    if (response.ContentLength) {
      res.setHeader("Content-Length", String(response.ContentLength));
    }
    if (response.ContentRange) {
      res.status(206);
      res.setHeader("Content-Range", response.ContentRange);
    }
    res.setHeader("Accept-Ranges", "bytes");
    if (options?.attachment) {
      res.setHeader("Content-Disposition", `attachment; filename=\"${clipFile}\"`);
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    const body = response.Body as unknown;
    if (body && typeof (body as { pipe?: unknown }).pipe === "function") {
      (body as Readable).pipe(res);
    } else if (body && typeof (body as ReadableStream).getReader === "function") {
      Readable.fromWeb(body as ReadableStream).pipe(res);
    } else {
      return res.status(502).json({ detail: "unsupported clip body" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ detail: message });
  }
};

app.get("/api/jobs/:jobId/clips/:clipFile", async (req, res) => {
  return streamClip(req, res);
});

app.get("/api/jobs/:jobId/clips/:clipFile/download", async (req, res) => {
  return streamClip(req, res, { attachment: true });
});

app.post("/api/callback/nosana", async (req, res) => {
  const payload = req.body as CallbackRequest;
  if (!payload?.job_id || !isValidJobId(payload.job_id)) {
    return res.status(400).json({ detail: "invalid job id" });
  }
  const data = await store.get(payload.job_id);
  if (!data) {
    return res.status(404).json({ detail: "job not found" });
  }
  await store.update(payload.job_id, {
    status: payload.status,
    r2_prefix: payload.r2_prefix,
    error: payload.error,
    stage: payload.stage ?? JOB_STAGE.DONE,
    progress: payload.progress ?? 100,
  });
  return res.json({ ok: true });
});

const port = Number(process.env.PORT || 8000);
app.listen(port, "127.0.0.1", () => {
  console.log(`Backend listening on http://127.0.0.1:${port}`);
});
