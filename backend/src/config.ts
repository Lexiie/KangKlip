import dotenv from "dotenv";

dotenv.config();

export type Config = {
  nosanaApiKey: string;
  nosanaMarket: string;
  nosanaWorkerImage: string;
  nosanaApiBase: string;
  redisUrl: string;
  r2Endpoint: string;
  r2Bucket: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  callbackBaseUrl: string;
  callbackToken: string;
  llmApiBase: string;
  llmModelName: string;
  llmApiKey?: string;
  corsOrigins: string[];
  renderResolution?: string;
  renderMaxFps?: string;
  renderCrf?: string;
  renderPreset?: string;
  captionFont?: string;
  captionFontSize?: string;
  captionMaxChars?: string;
  captionMaxLines?: string;
  captionMarginH?: string;
  captionMarginV?: string;
};

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing env var ${key}`);
  }
  return value;
};

const parseCorsOrigins = (): string[] => {
  const raw = process.env.CORS_ORIGINS;
  if (raw) {
    const origins = raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.length > 0) {
      return origins;
    }
  }
  return ["http://localhost:3000", "http://127.0.0.1:3000"];
};

export const getConfig = (): Config => {
  return {
    nosanaApiKey: required("NOSANA_API_KEY"),
    nosanaMarket: required("NOSANA_MARKET"),
    nosanaWorkerImage: required("NOSANA_WORKER_IMAGE"),
    nosanaApiBase: process.env.NOSANA_API_BASE || "https://dashboard.k8s.prd.nos.ci/api",
    redisUrl: required("REDIS_URL"),
    r2Endpoint: required("R2_ENDPOINT"),
    r2Bucket: required("R2_BUCKET"),
    r2AccessKeyId: required("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    callbackBaseUrl: required("CALLBACK_BASE_URL"),
    callbackToken: required("CALLBACK_TOKEN"),
    llmApiBase: required("LLM_API_BASE"),
    llmModelName: required("LLM_MODEL_NAME"),
    llmApiKey: process.env.LLM_API_KEY,
    corsOrigins: parseCorsOrigins(),
    renderResolution: process.env.RENDER_RESOLUTION,
    renderMaxFps: process.env.RENDER_MAX_FPS,
    renderCrf: process.env.RENDER_CRF,
    renderPreset: process.env.RENDER_PRESET,
    captionFont: process.env.CAPTION_FONT,
    captionFontSize: process.env.CAPTION_FONT_SIZE,
    captionMaxChars: process.env.CAPTION_MAX_CHARS,
    captionMaxLines: process.env.CAPTION_MAX_LINES,
    captionMarginH: process.env.CAPTION_MARGIN_H,
    captionMarginV: process.env.CAPTION_MARGIN_V,
  };
};

export const normalizeApiBase = (base: string): string => {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
};

export const normalizeSdkBase = (base: string): string => {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
};
