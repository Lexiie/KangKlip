import cors from "cors";
import crypto from "crypto";
import express from "express";
import { Readable } from "stream";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ulid } from "ulid";
import { getConfig } from "./config.js";
import { JobRecord, JobStore } from "./storage.js";
import {
  JOB_STATUS,
  JOB_STAGE,
  CallbackRequest,
  isValidJobId,
  validateJobCreate,
} from "./models.js";
import { createDeployment, createNosanaClient, fetchMarketCache, startDeployment } from "./nosana.js";
import { getObjectStream, loadManifest, signObjectUrl } from "./r2.js";
import {
  CREDIT_UNIT,
  buildConsumeCreditInstruction,
  buildPayUsdcInstructionData,
  deriveAssociatedTokenAddress,
  deriveConfigPda,
  deriveUserCreditPda,
} from "./credits_client.js";
import {
  decodeUserCreditAccount,
  fetchAccountData,
  fetchParsedTransaction,
  hasProgramInstruction,
  isValidPublicKey,
  verifySignature,
  loadKeypair,
} from "./solana.js";

const config = getConfig();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: false,
  })
);
const store = new JobStore(config.redisUrl);
await store.connect();
const nosana = createNosanaClient(config);
const solanaConnection = new Connection(config.solanaRpcUrl, "confirmed");
const spenderKeypair = loadKeypair(config.spenderKeypair);

// Generate a ULID-based job id.
const buildJobId = () => `kk_${ulid()}`;
// Build the callback URL for worker status updates.
const buildCallbackUrl = (base: string) => `${base.replace(/\/$/, "")}/api/callback/nosana`;

// Require a valid job token header for job-specific routes.
const requireJobToken = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const jobId = req.params.jobId;
  const data = await store.get(jobId);
  if (!data) {
    return res.status(404).json({ detail: "job not found" });
  }
  const token = req.get("x-job-token");
  if (!token || token !== data.job_token) {
    return res.status(401).json({ detail: "invalid job token" });
  }
  res.locals.jobRecord = data;
  return next();
};

// Requires a valid short-lived auth token bound to a wallet.
const requireAuthToken = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const token = req.get("x-auth-token");
  if (!token) {
    return res.status(401).json({ detail: "auth token required" });
  }
  const wallet = await store.getAuthTokenWallet(token);
  if (!wallet) {
    return res.status(401).json({ detail: "invalid auth token" });
  }
  res.locals.authWallet = wallet;
  return next();
};

// Build the environment variables passed to the worker container.
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
    TRANSCRIPT_MODE: "asr_only",
    ASR_FALLBACK: "false",
    ASR_MODEL: "small",
    R2_ENDPOINT: config.r2Endpoint,
    R2_BUCKET: config.r2Bucket,
    R2_ACCESS_KEY_ID: config.r2AccessKeyId,
    R2_SECRET_ACCESS_KEY: config.r2SecretAccessKey,
    LLM_API_BASE: config.llmApiBase,
    LLM_TIMEOUT_SECONDS: "20",
    LLM_MODEL_NAME: config.llmModelName,
    CALLBACK_URL: buildCallbackUrl(config.callbackBaseUrl),
    CALLBACK_TOKEN: config.callbackToken,
    R2_PREFIX: `jobs/${jobId}/`,
  };
  const optionalEnv: Record<string, string | undefined> = {
    RENDER_RESOLUTION: config.renderResolution,
    RENDER_MAX_FPS: config.renderMaxFps,
    RENDER_CRF: config.renderCrf,
    RENDER_PRESET: config.renderPreset,
    CAPTION_FONT: config.captionFont,
    CAPTION_FONT_SIZE: config.captionFontSize,
    CAPTION_MAX_CHARS: config.captionMaxChars,
    CAPTION_MAX_LINES: config.captionMaxLines,
    CAPTION_MARGIN_H: config.captionMarginH,
    CAPTION_MARGIN_V: config.captionMarginV,
    ASR_SKIP_SECOND_PASS: config.asrSkipSecondPass,
  };
  for (const [key, value] of Object.entries(optionalEnv)) {
    if (value) {
      env[key] = value;
    }
  }
  if (config.llmApiKey) {
    env.LLM_API_KEY = config.llmApiKey;
  }
  return env;
};

// Validate a clip file and resolve its R2 object key.
const resolveClipKey = async (
  jobId: string,
  clipFile: string,
  data: JobRecord
): Promise<{ key: string } | { error: string; status: number }> => {
  if (data.status !== JOB_STATUS.SUCCEEDED) {
    return { error: "job not completed", status: 409 };
  }
  const r2Prefix = data.r2_prefix as string | undefined;
  if (!r2Prefix) {
    return { error: "missing r2 prefix", status: 500 };
  }
  try {
    const manifest = await loadManifest(config, r2Prefix);
    const clips = (manifest.clips as Array<Record<string, unknown>>) || [];
    const allowed = new Set(clips.map((clip) => String(clip.file ?? "")));
    if (!allowed.has(clipFile)) {
      return { error: "clip not found", status: 404 };
    }
    const key = `${r2Prefix.replace(/\/+$/, "")}/${clipFile}`;
    return { key };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, status: 502 };
  }
};

// Reads UserCredit credits from chain.
const fetchOnchainCredits = async (walletAddress: string): Promise<number> => {
  const programId = new PublicKey(config.creditsProgramId);
  const userKey = new PublicKey(walletAddress);
  const userCreditPda = deriveUserCreditPda(userKey, programId);
  const accountData = await fetchAccountData(config.solanaRpcUrl, userCreditPda.toBase58());
  if (!accountData) {
    return 0;
  }
  const decoded = decodeUserCreditAccount(accountData);
  if (!decoded || decoded.user !== walletAddress) {
    return 0;
  }
  const credits = Number(decoded.credits);
  return Number.isFinite(credits) ? credits : 0;
};

// Sends a consume_credit instruction signed by the backend spender key.
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// Sanitize memo input and keep it within Solana memo limits.
const buildMemo = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= 64) {
    return trimmed;
  }
  return crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 64);
};

// Submit a consume_credit instruction via the backend spender key.
const consumeOnchainCredit = async (
  walletAddress: string,
  amount: number,
  memo?: string
) => {
  const programId = new PublicKey(config.creditsProgramId);
  const authority = new PublicKey(config.treasuryAddress);
  const userKey = new PublicKey(walletAddress);
  const configPda = deriveConfigPda(authority, programId);
  const userCreditPda = deriveUserCreditPda(userKey, programId);
  const instruction = buildConsumeCreditInstruction({
    programId,
    spender: spenderKeypair.publicKey,
    config: configPda,
    user: userKey,
    userCredit: userCreditPda,
    amount: BigInt(amount),
  });
  const tx = new Transaction();
  const safeMemo = buildMemo(memo);
  if (safeMemo) {
    tx.add(
      new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(safeMemo, "utf-8"),
      })
    );
  }
  tx.add(instruction);
  tx.feePayer = spenderKeypair.publicKey;
  const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash(
    "confirmed"
  );
  tx.recentBlockhash = blockhash;
  tx.sign(spenderKeypair);
  const signature = await solanaConnection.sendRawTransaction(tx.serialize());
  const confirmation = await solanaConnection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (confirmation.value.err) {
    throw new Error("consume_credit_failed");
  }
  return signature;
};

// Create a new job and return the job id + job token.
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
  const jobToken = crypto.randomBytes(32).toString("hex");
  await store.set(jobId, {
    job_id: jobId,
    job_token: jobToken,
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
    try {
      const startError = await startDeployment(nosana, deploymentId);
      if (startError) {
        await store.update(jobId, { start_error: startError });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.update(jobId, { start_error: message });
    }
  }, 0);

  return res.json({ job_id: jobId, job_token: jobToken, status: JOB_STATUS.QUEUED });
});

// Fetch job status and progress.
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
    error: data.error ?? null,
  });
});

// Issue a wallet signature challenge nonce.
app.post("/api/auth/challenge", async (req, res) => {
  const walletAddress = req.body?.wallet_address;
  if (!walletAddress || typeof walletAddress !== "string" || !isValidPublicKey(walletAddress)) {
    return res.status(400).json({ detail: "wallet_address is required" });
  }
  const nonce = crypto.randomBytes(32).toString("hex");
  const timestamp = new Date().toISOString();
  const challenge = `KANGKLIP_AUTH:${walletAddress}:${nonce}:${timestamp}`;
  const expiresIn = 300;
  await store.setAuthNonce(
    nonce,
    {
      wallet: walletAddress,
      challenge,
      expires_at: Date.now() + expiresIn * 1000,
    },
    expiresIn
  );
  return res.json({
    wallet_address: walletAddress,
    challenge,
    nonce,
    expires_in: expiresIn,
  });
});

// Verify a signed wallet challenge and mint an auth token.
app.post("/api/auth/verify", async (req, res) => {
  const walletAddress = req.body?.wallet_address;
  const nonce = req.body?.nonce;
  const signature = req.body?.signature;
  if (!walletAddress || typeof walletAddress !== "string" || !isValidPublicKey(walletAddress)) {
    return res.status(400).json({ detail: "wallet_address is required" });
  }
  if (!nonce || typeof nonce !== "string") {
    return res.status(400).json({ detail: "nonce is required" });
  }
  if (!signature || typeof signature !== "string") {
    return res.status(400).json({ detail: "signature is required" });
  }
  const payload = await store.getAuthNonce(nonce);
  if (!payload) {
    return res.status(400).json({ detail: "invalid nonce" });
  }
  const payloadWallet = typeof payload.wallet === "string" ? payload.wallet : null;
  const challenge = typeof payload.challenge === "string" ? payload.challenge : null;
  const expiresAt = typeof payload.expires_at === "number" ? payload.expires_at : null;
  if (!payloadWallet || payloadWallet !== walletAddress || !challenge) {
    return res.status(400).json({ detail: "invalid nonce" });
  }
  if (expiresAt && Date.now() > expiresAt) {
    await store.deleteAuthNonce(nonce);
    return res.status(400).json({ detail: "nonce expired" });
  }
  const valid = verifySignature(walletAddress, challenge, signature);
  if (!valid) {
    return res.status(401).json({ detail: "invalid signature" });
  }
  const authToken = crypto.randomBytes(32).toString("hex");
  const ttl = 86400;
  await store.setAuthToken(authToken, walletAddress, ttl);
  await store.deleteAuthNonce(nonce);
  return res.json({ auth_token: authToken, expires_in: ttl });
});

// Trigger job execution on Nosana.
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

// Return clip metadata with lock state and action endpoints.
app.get("/api/jobs/:jobId/results", requireJobToken, async (req, res) => {
  const jobId = req.params.jobId;
  const data = (res.locals.jobRecord as JobRecord | undefined) ?? (await store.get(jobId));
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
    const entries = clips
      .map((clip) => {
        const file = String(clip.file ?? "");
        if (!file) {
          return null;
        }
        return { clip, file };
      })
      .filter((entry): entry is { clip: Record<string, unknown>; file: string } => Boolean(entry));
    const unlockStates = await Promise.all(
      entries.map((entry) => store.isClipUnlocked(jobId, entry.file))
    );
    const results = entries.map((entry, index) => {
      const locked = !unlockStates[index];
      return {
        clip_file: entry.file,
        title: String(entry.clip.title ?? ""),
        duration: Number(entry.clip.duration ?? 0),
        locked,
        unlock_endpoint: `/api/jobs/${jobId}/clips/${entry.file}/unlock`,
        download_endpoint: `/api/jobs/${jobId}/clips/${entry.file}/download`,
        preview_endpoint: `/api/jobs/${jobId}/clips/${entry.file}/preview`,
      };
    });
    return res.json({ clips: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ detail: message });
  }
});

// Stream clip bytes from R2 to the client.
const streamClip = async (
  req: express.Request,
  res: express.Response,
  options?: { attachment?: boolean }
) => {
  const jobId = req.params.jobId;
  const clipFile = req.params.clipFile;
  const data = (res.locals.jobRecord as JobRecord | undefined) ?? (await store.get(jobId));
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

// Stream a clip object directly when proxying through the backend.
app.get("/api/jobs/:jobId/clips/:clipFile", requireJobToken, async (req, res) => {
  return streamClip(req, res);
});

// Return a signed download URL for unlocked clips.
app.get(
  "/api/jobs/:jobId/clips/:clipFile/download",
  requireJobToken,
  async (req, res) => {
    const jobId = req.params.jobId;
    const clipFile = req.params.clipFile;
    const data = (res.locals.jobRecord as JobRecord | undefined) ?? (await store.get(jobId));
    if (!data) {
      return res.status(404).json({ detail: "job not found" });
    }
    const resolved = await resolveClipKey(jobId, clipFile, data);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ detail: resolved.error });
    }
    const unlocked = await store.isClipUnlocked(jobId, clipFile);
    if (!unlocked) {
      return res.status(403).json({ error: "locked" });
    }
    const expiresIn = 86400;
    try {
      const url = await signObjectUrl(config, resolved.key, expiresIn);
      return res.json({ url, expires_in: expiresIn });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(502).json({ detail: message });
    }
  }
);

// Return a short-lived preview URL for clips.
app.get(
  "/api/jobs/:jobId/clips/:clipFile/preview",
  requireJobToken,
  async (req, res) => {
    const jobId = req.params.jobId;
    const clipFile = req.params.clipFile;
    const data = (res.locals.jobRecord as JobRecord | undefined) ?? (await store.get(jobId));
    if (!data) {
      return res.status(404).json({ detail: "job not found" });
    }
    const resolved = await resolveClipKey(jobId, clipFile, data);
    if ("error" in resolved) {
      return res.status(resolved.status).json({ detail: resolved.error });
    }
    const expiresIn = 600;
    try {
      const url = await signObjectUrl(config, resolved.key, expiresIn);
      return res.json({ url, expires_in: expiresIn });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(502).json({ detail: message });
    }
  }
);

// Unlock a clip by consuming on-chain credits.
app.post(
  "/api/jobs/:jobId/clips/:clipFile/unlock",
  requireJobToken,
  requireAuthToken,
  async (req, res) => {
    const jobId = req.params.jobId;
    const clipFile = req.params.clipFile;
    const data = (res.locals.jobRecord as JobRecord | undefined) ?? (await store.get(jobId));
    if (!data) {
      return res.status(404).json({ detail: "job not found" });
    }
    if (data.status !== JOB_STATUS.SUCCEEDED) {
      return res.status(409).json({ detail: "job not completed" });
    }
    const unlockRequestId = req.body?.unlock_request_id;
    if (!unlockRequestId || typeof unlockRequestId !== "string") {
      return res.status(400).json({ detail: "unlock_request_id is required" });
    }
    const authWallet = res.locals.authWallet as string | undefined;
    if (!authWallet || !isValidPublicKey(authWallet)) {
      return res.status(401).json({ detail: "invalid auth token" });
    }
    const walletAddress = authWallet;
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
      const totalCredits = await fetchOnchainCredits(walletAddress);
      const spentCredits = await store.getSpentCredits(walletAddress);
      const availableCredits = Math.max(0, totalCredits - spentCredits);
      const unlockPending = await store.getUnlockPending(unlockRequestId);
      if (unlockPending) {
        const pendingJob =
          typeof unlockPending.jobId === "string" ? unlockPending.jobId : null;
        const pendingClip =
          typeof unlockPending.clipFile === "string" ? unlockPending.clipFile : null;
        if (pendingJob === jobId && pendingClip === clipFile) {
          try {
            await store.setClipUnlocked(jobId, clipFile);
            await store.deleteUnlockPending(unlockRequestId);
            await store.setIdempotencyResult(unlockRequestId, {
              job_id: jobId,
              clip_file: clipFile,
              unlocked: true,
              charged_credits: 0,
              idempotency: "REPLAY",
            });
          } catch {
            return res.status(502).json({ detail: "failed to finalize unlock" });
          }
          return res.json({
            job_id: jobId,
            clip_file: clipFile,
            unlocked: true,
            charged_credits: 0,
            idempotency: "REPLAY",
          });
        }
      }

      const alreadyUnlocked = await store.isClipUnlocked(jobId, clipFile);
      if (alreadyUnlocked) {
        await store.setIdempotencyResult(unlockRequestId, {
          job_id: jobId,
          clip_file: clipFile,
          unlocked: true,
          charged_credits: 0,
          idempotency: "REPLAY",
        });
        return res.json({
          job_id: jobId,
          clip_file: clipFile,
          unlocked: true,
          charged_credits: 0,
          idempotency: "REPLAY",
        });
      }

      const idem = await store.getIdempotencyResult(unlockRequestId);
      if (idem) {
        if (idem.status === "pending") {
          return res.status(409).json({ detail: "unlock in progress" });
        }
        return res.json(idem);
      }
      const lockSet = await store.setIdempotencyIfAbsent(unlockRequestId, {
        status: "pending",
      });
      if (!lockSet) {
        const replay = await store.getIdempotencyResult(unlockRequestId);
        if (replay) {
          return res.json(replay);
        }
        return res.status(409).json({ detail: "unlock in progress" });
      }

      const totalCredits = await fetchOnchainCredits(walletAddress);
      if (totalCredits < 1) {
        await store.setIdempotencyResult(unlockRequestId, {
          job_id: jobId,
          clip_file: clipFile,
          unlocked: false,
          charged_credits: 0,
          idempotency: "NEW",
        });
        return res.status(402).json({ detail: "insufficient_credits" });
      }

      let signature: string;
      try {
        signature = await consumeOnchainCredit(walletAddress, 1, unlockRequestId);
      } catch {
        const refreshedCredits = await fetchOnchainCredits(walletAddress);
        await store.setIdempotencyResult(unlockRequestId, {
          job_id: jobId,
          clip_file: clipFile,
          unlocked: false,
          charged_credits: 0,
          idempotency: "NEW",
        });
        if (refreshedCredits < 1) {
          return res.status(402).json({ detail: "insufficient_credits" });
        }
        return res.status(502).json({ detail: "consume_credit_failed" });
      }

      await store.setUnlockPending(unlockRequestId, {
        jobId,
        clipFile,
        wallet: walletAddress,
        txSig: signature,
      });

      await store.setClipUnlocked(jobId, clipFile);
      await store.deleteUnlockPending(unlockRequestId);
      await store.setIdempotencyResult(unlockRequestId, {
        job_id: jobId,
        clip_file: clipFile,
        unlocked: true,
        charged_credits: 1,
        idempotency: "NEW",
      });

      console.info("unlock", {
        jobId,
        clipFile,
        wallet: walletAddress,
        requestId: unlockRequestId,
        charged_credits: 1,
        idempotency: "NEW",
        txSig: signature,
      });

      return res.json({
        job_id: jobId,
        clip_file: clipFile,
        unlocked: true,
        charged_credits: 1,
        idempotency: "NEW",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(502).json({ detail: message });
    }
  }
);

// Accept job status callbacks from the worker.
app.post("/api/callback/nosana", async (req, res) => {
  const token = req.get("x-callback-token");
  if (token !== config.callbackToken) {
    return res.status(401).json({ detail: "invalid callback token" });
  }
  const payload = req.body as CallbackRequest;
  if (!payload?.job_id || !isValidJobId(payload.job_id)) {
    return res.status(400).json({ detail: "invalid job id" });
  }
  if (!Object.values(JOB_STATUS).includes(payload.status)) {
    return res.status(400).json({ detail: "invalid status" });
  }
  const data = await store.get(payload.job_id);
  if (!data) {
    return res.status(404).json({ detail: "job not found" });
  }
  const updates: Record<string, unknown> = {
    status: payload.status,
  };
  if (payload.r2_prefix) {
    updates.r2_prefix = payload.r2_prefix;
  }
  if (payload.error) {
    updates.error = payload.error;
  }
  if (payload.stage && Object.values(JOB_STAGE).includes(payload.stage)) {
    updates.stage = payload.stage;
  } else if ([JOB_STATUS.SUCCEEDED, JOB_STATUS.FAILED].includes(payload.status)) {
    updates.stage = JOB_STAGE.DONE;
  }
  if (typeof payload.progress === "number" && Number.isFinite(payload.progress)) {
    updates.progress = Math.min(100, Math.max(0, payload.progress));
  } else if ([JOB_STATUS.SUCCEEDED, JOB_STATUS.FAILED].includes(payload.status)) {
    updates.progress = 100;
  }
  await store.update(payload.job_id, updates);
  return res.json({ ok: true });
});

// Return the on-chain credit balance for the authenticated wallet.
app.get("/api/credits/balance", requireAuthToken, async (req, res) => {
  const authWallet = res.locals.authWallet as string | undefined;
  const walletQuery = req.query.wallet as string | undefined;
  if (!authWallet || !isValidPublicKey(authWallet)) {
    return res.status(401).json({ detail: "invalid auth token" });
  }
  if (walletQuery && walletQuery !== authWallet) {
    return res.status(403).json({ detail: "wallet mismatch" });
  }
  const credits = await fetchOnchainCredits(authWallet);
  return res.json({ credits });
});

// Build a top-up intent with the pay_usdc instruction payload.
app.post("/api/credits/topup/usdc/intent", requireAuthToken, async (req, res) => {
  const authWallet = res.locals.authWallet as string | undefined;
  const creditsToBuy = req.body?.credits_to_buy;
  if (!authWallet || !isValidPublicKey(authWallet)) {
    return res.status(401).json({ detail: "invalid auth token" });
  }
  const credits = Number(creditsToBuy);
  if (!Number.isFinite(credits) || credits <= 0 || !Number.isInteger(credits)) {
    return res.status(400).json({ detail: "credits_to_buy must be a positive integer" });
  }
  const amountBaseUnits = credits * CREDIT_UNIT;
  const programId = new PublicKey(config.creditsProgramId);
  const authority = new PublicKey(config.treasuryAddress);
  const usdcMint = new PublicKey(config.usdcMint);
  const walletKey = new PublicKey(authWallet);
  const configPda = deriveConfigPda(authority, programId);
  const userCreditPda = deriveUserCreditPda(walletKey, programId);
  const vaultAta = deriveAssociatedTokenAddress(configPda, usdcMint);
  const userAta = deriveAssociatedTokenAddress(walletKey, usdcMint);
  const instructionData = buildPayUsdcInstructionData(BigInt(amountBaseUnits)).toString("base64");
  return res.json({
    wallet_address: authWallet,
    credits_to_buy: credits,
    amount_base_units: amountBaseUnits,
    credit_unit: CREDIT_UNIT,
    program_id: programId.toBase58(),
    config_pda: configPda.toBase58(),
    user_credit_pda: userCreditPda.toBase58(),
    vault_ata: vaultAta.toBase58(),
    user_usdc_ata: userAta.toBase58(),
    usdc_mint: usdcMint.toBase58(),
    instruction_data: instructionData,
  });
});

// Confirm a top-up transaction and refresh balance.
app.post("/api/credits/topup/usdc/confirm", requireAuthToken, async (req, res) => {
  const authWallet = res.locals.authWallet as string | undefined;
  const signature = req.body?.signature;
  if (!authWallet || !isValidPublicKey(authWallet)) {
    return res.status(401).json({ detail: "invalid auth token" });
  }
  if (!signature || typeof signature !== "string") {
    return res.status(400).json({ detail: "signature is required" });
  }
  const already = await store.hasTopupSignature(signature);
  if (already) {
    const credits = await fetchOnchainCredits(authWallet);
    return res.json({ credited: true, new_balance: credits });
  }
  const tx = await fetchParsedTransaction(config.solanaRpcUrl, signature);
  if (!tx) {
    return res.status(404).json({ detail: "transaction not found" });
  }
  if (tx.meta?.err) {
    return res.status(400).json({ detail: "transaction failed" });
  }
  if (!hasProgramInstruction(tx, config.creditsProgramId)) {
    return res.status(400).json({ detail: "invalid program" });
  }
  const marked = await store.markTopupSignature(signature);
  if (!marked) {
    const credits = await fetchOnchainCredits(authWallet);
    return res.json({ credited: true, new_balance: credits });
  }
  const credits = await fetchOnchainCredits(authWallet);
  return res.json({ credited: true, new_balance: credits });
});

// Deprecated top-up quote endpoint.
app.post("/api/credits/topup/quote", async (req, res) => {
  return res.status(410).json({ detail: "use /api/credits/topup/usdc/intent" });
});

// Deprecated top-up confirm endpoint.
app.post("/api/credits/topup/confirm", requireAuthToken, async (req, res) => {
  return res.status(410).json({ detail: "use /api/credits/topup/usdc/confirm" });
});

const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";
// Start the HTTP server.
app.listen(port, host, () => {
  console.log(`Backend listening on http://${host}:${port}`);
});
