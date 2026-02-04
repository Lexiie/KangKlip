"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import WalletButton from "../../components/wallet-button";
import { useAuth } from "../../providers/auth";
import { readJobToken, storeJobToken } from "../../lib/jobToken";

type JobStatusResponse = {
  job_id: string;
  status: string;
  stage?: string;
  progress?: number;
  error?: string | null;
};

type ClipResult = {
  clip_file: string;
  title?: string;
  duration?: number;
  locked: boolean;
  unlock_endpoint: string;
  download_endpoint: string;
  preview_endpoint?: string;
};

type JobResultsResponse = {
  clips: ClipResult[];
};

type ClipActionState = "idle" | "unlocking" | "downloading";

const buildRequestId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export default function JobPage() {
  const params = useParams();
  const jobId = params?.job_id as string;
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  const { authToken, status: authStatus } = useAuth();
  const [jobToken, setJobToken] = useState<string | null>(null);
  const [manualJobToken, setManualJobToken] = useState("");
  const [status, setStatus] = useState<JobStatusResponse | null>(null);
  const [results, setResults] = useState<JobResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [clipActions, setClipActions] = useState<Record<string, ClipActionState>>({});
  const jobIdRef = useRef<string | null>(null);

  jobIdRef.current = jobId ?? null;

  useEffect(() => {
    if (!jobId) {
      return;
    }
    setJobToken(readJobToken(jobId));
    setStatus(null);
    setResults(null);
    setError(null);
    setActionError(null);
    setCreditsBalance(null);
    setPreviewUrls({});
    setPreviewErrors({});
    setClipActions({});
  }, [jobId]);

  const resolveEndpoint = useCallback(
    (endpoint: string) => (endpoint.startsWith("http") ? endpoint : `${apiBase}${endpoint}`),
    [apiBase]
  );

  const buildHeaders = useCallback(
    (includeAuth: boolean) => {
      const headers: Record<string, string> = {};
      if (jobToken) {
        headers["x-job-token"] = jobToken;
      }
      if (includeAuth && authToken) {
        headers["x-auth-token"] = authToken;
      }
      return headers;
    },
    [authToken, jobToken]
  );

  const refreshCredits = useCallback(async () => {
    if (!authToken) {
      setCreditsBalance(null);
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/credits/balance`, {
        headers: buildHeaders(true),
      });
      if (!response.ok) {
        throw new Error("Failed to load credits");
      }
      const payload = (await response.json()) as { credits: number };
      setCreditsBalance(payload.credits);
    } catch {
      setCreditsBalance(null);
    }
  }, [apiBase, authToken, buildHeaders]);

  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  const loadResults = useCallback(async () => {
    if (!jobId) return;
    if (!jobToken) {
      return;
    }
    const requestJobId = jobId;
    try {
      const response = await fetch(`${apiBase}/api/jobs/${jobId}/results`, {
        headers: buildHeaders(false),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to load job results");
      }
      const data = (await response.json()) as JobResultsResponse;
      if (jobIdRef.current !== requestJobId) {
        return;
      }
      setResults(data);
    } catch (err) {
      if (jobIdRef.current !== requestJobId) {
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [apiBase, buildHeaders, jobId, jobToken]);

  const loadStatus = useCallback(async () => {
    if (!jobId) return;
    const requestJobId = jobId;
    try {
      const response = await fetch(`${apiBase}/api/jobs/${jobId}`, {
        headers: buildHeaders(false),
      });
      if (!response.ok) {
        throw new Error("Failed to load job status");
      }
      const data = (await response.json()) as JobStatusResponse;
      if (jobIdRef.current !== requestJobId) {
        return;
      }
      setStatus(data);
      if (data.status === "FAILED" && data.error) {
        setError(data.error);
      }
      if (data.status === "SUCCEEDED" && !results && jobToken) {
        await loadResults();
      }
    } catch (err) {
      if (jobIdRef.current !== requestJobId) {
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [apiBase, buildHeaders, jobId, loadResults, results]);

  const loadPreview = useCallback(
    async (clip: ClipResult, force = false) => {
      if (!clip.preview_endpoint || !jobToken) {
        return;
      }
      if (!force && previewUrls[clip.clip_file]) {
        return;
      }
      if (force) {
        setPreviewUrls((prev) => {
          const next = { ...prev };
          delete next[clip.clip_file];
          return next;
        });
      }
      setPreviewErrors((prev) => ({ ...prev, [clip.clip_file]: "" }));
      try {
        const response = await fetch(resolveEndpoint(clip.preview_endpoint), {
          headers: buildHeaders(false),
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Preview unavailable");
        }
        const payload = (await response.json()) as { url: string };
        setPreviewUrls((prev) => ({ ...prev, [clip.clip_file]: payload.url }));
      } catch (err) {
        setPreviewErrors((prev) => ({
          ...prev,
          [clip.clip_file]: err instanceof Error ? err.message : "Preview failed",
        }));
      }
    },
    [buildHeaders, jobToken, previewUrls, resolveEndpoint]
  );

  useEffect(() => {
    if (!results?.clips?.length) {
      return;
    }
    results.clips.forEach((clip) => {
      if (!previewUrls[clip.clip_file]) {
        loadPreview(clip);
      }
    });
  }, [loadPreview, previewUrls, results]);

  const unlockClip = useCallback(
    async (clip: ClipResult) => {
      setActionError(null);
      if (!jobToken) {
        setActionError("Job token missing. Please reopen this job link.");
        return;
      }
      if (!authToken) {
        setActionError("Connect a wallet to unlock clips.");
        return;
      }
      setClipActions((prev) => ({ ...prev, [clip.clip_file]: "unlocking" }));
      try {
        const response = await fetch(resolveEndpoint(clip.unlock_endpoint), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildHeaders(true),
          },
          body: JSON.stringify({ unlock_request_id: buildRequestId() }),
        });
        if (response.status === 402) {
          throw new Error("Insufficient credits.");
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Unlock failed");
        }
        setResults((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            clips: prev.clips.map((item) =>
              item.clip_file === clip.clip_file ? { ...item, locked: false } : item
            ),
          };
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Unlock failed");
      } finally {
        setClipActions((prev) => ({ ...prev, [clip.clip_file]: "idle" }));
      }
    },
    [authToken, buildHeaders, jobToken, resolveEndpoint]
  );

  const downloadClip = useCallback(
    async (clip: ClipResult) => {
      setActionError(null);
      if (!jobToken) {
        setActionError("Job token missing. Please reopen this job link.");
        return;
      }
      if (!authToken) {
        setActionError("Connect a wallet to download unlocked clips.");
        return;
      }
      setClipActions((prev) => ({ ...prev, [clip.clip_file]: "downloading" }));
      try {
        const response = await fetch(resolveEndpoint(clip.download_endpoint), {
          headers: buildHeaders(true),
        });
        if (response.status === 403) {
          throw new Error("Clip is still locked.");
        }
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Download unavailable");
        }
        const payload = (await response.json()) as { url: string };
        window.open(payload.url, "_blank", "noopener,noreferrer");
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Download failed");
      } finally {
        setClipActions((prev) => ({ ...prev, [clip.clip_file]: "idle" }));
      }
    },
    [authToken, buildHeaders, jobToken, resolveEndpoint]
  );

  const isTerminal = status?.status === "SUCCEEDED" || status?.status === "FAILED";
  const shouldPoll = !isTerminal || (status?.status === "SUCCEEDED" && !results);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await loadStatus();
    };
    if (!shouldPoll) {
      return () => {
        cancelled = true;
      };
    }
    tick();
    const interval = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId, loadStatus, shouldPoll]);

  const shortJobId = jobId ? `${jobId.slice(0, 6)}…${jobId.slice(-4)}` : "";
  const [showFullId, setShowFullId] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");

  const copyJobId = async () => {
    try {
      await navigator.clipboard.writeText(jobId);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      setCopyStatus("idle");
    }
  };

  const authHint = useMemo(() => {
    if (authStatus === "ready") {
      return "Wallet authenticated";
    }
    if (authStatus === "authenticating") {
      return "Signing wallet message…";
    }
    return "Connect wallet to unlock clips";
  }, [authStatus]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 pb-10 pt-20">
      <header className="reveal stagger-1 relative overflow-hidden rounded-3xl border border-white/10 bg-black/70 p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.85)] backdrop-blur">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-20 top-6 h-40 w-40 rounded-full bg-white/10 blur-[80px]" />
          <div className="absolute bottom-0 left-8 h-40 w-40 rounded-full bg-white/5 blur-[90px]" />
        </div>
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/55">
              Job Status
            </p>
            <div className="flex items-center gap-2">
              <WalletButton />
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Credits {creditsBalance === null ? "–" : creditsBalance}
              </span>
              <a
                href="/topup"
                className="hidden border border-white/20 bg-black px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/70 transition hover:border-red-400/70 hover:text-white sm:inline-flex"
              >
                Top Up
              </a>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/60">
                Live
              </span>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white">
                {status?.status ?? "Loading"}
              </span>
              <span className="text-xs font-semibold text-white/60">
                Stage: {status?.stage ?? "Preparing"}
              </span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/60 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowFullId((prev) => !prev)}
                  className="text-left text-xs font-semibold text-white/80"
                >
                  {showFullId ? "Hide Job ID" : "Show Job ID"}
                </button>
                <button
                  type="button"
                  onClick={copyJobId}
                  className="text-xs font-semibold text-white/80"
                >
                  {copyStatus === "copied" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 break-all font-mono text-xs text-white/45">
                {showFullId ? jobId : shortJobId}
              </p>
            </div>
          </div>

          {typeof status?.progress === "number" ? (
            <div className="mt-4 h-2 w-full rounded-full bg-white/10">
              <div
                className="h-2 rounded-full bg-red-500"
                style={{ width: `${status.progress}%` }}
              />
            </div>
          ) : null}
        </div>
      </header>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {actionError ? <p className="text-sm text-red-300">{actionError}</p> : null}

      {!jobToken ? (
        <section className="reveal stagger-2 rounded-3xl border border-white/10 bg-black/60 p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.85)] backdrop-blur">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/55">
              Job token required
            </p>
            <p className="text-sm text-white/60">
              Paste the job token you received when creating this job to unlock results.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={manualJobToken}
                onChange={(event) => setManualJobToken(event.target.value)}
                placeholder="job_token..."
                className="flex-1 border border-white/40 bg-black px-4 py-3 text-base text-white outline-none transition focus:border-red-500/80"
              />
              <button
                type="button"
                onClick={() => {
                  if (!manualJobToken || !jobId) return;
                  storeJobToken(jobId, manualJobToken);
                  setJobToken(manualJobToken);
                  setManualJobToken("");
                }}
                className="inline-flex items-center justify-center border border-red-500/70 bg-red-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-400"
              >
                Save Token
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="reveal stagger-3 rounded-3xl border border-white/10 bg-black/60 p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.85)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/55">Credits</p>
            <p className="mt-1 text-2xl font-display text-white">
              {creditsBalance === null ? "–" : creditsBalance}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshCredits}
              className="border border-white/20 bg-black px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/70 transition hover:border-red-400/70 hover:text-white"
            >
              Refresh
            </button>
            <a
              href="/topup"
              className="border border-red-500/70 bg-red-500 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-white transition hover:bg-red-400"
            >
              Top Up
            </a>
          </div>
        </div>
      </section>

      <section className="reveal stagger-4 rounded-3xl border border-white/10 bg-black/60 p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.85)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white">Results</h2>
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/55">
            {authHint}
          </span>
        </div>
        {status?.status === "FAILED" ? (
          <p className="mt-3 text-sm text-red-300">
            Job failed{status?.error ? `: ${status.error}` : "."}
          </p>
        ) : !results ? (
          <p className="mt-3 text-sm text-white/55">Clips will appear once the job finishes.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {results.clips.map((clip, index) => {
              const previewUrl = previewUrls[clip.clip_file];
              const previewError = previewErrors[clip.clip_file];
              const clipAction = clipActions[clip.clip_file] ?? "idle";

              return (
                <div
                  key={clip.clip_file || `clip-${index}`}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/50 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">
                      {clip.title || `Clip ${index + 1}`}
                    </p>
                    <span className="text-xs text-white/55">
                      {clip.duration ? `${clip.duration}s` : ""}
                    </span>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70">
                    {previewUrl ? (
                      <video
                        className="w-full max-h-[70vh] object-contain"
                        src={previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <div className="flex h-40 items-center justify-center text-xs text-white/45">
                        {previewError ? "Preview unavailable" : "Loading preview…"}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span
                      className={`text-xs font-semibold uppercase tracking-[0.3em] ${
                        clip.locked ? "text-white/50" : "text-red-400"
                      }`}
                    >
                      {clip.locked ? "Locked" : "Unlocked"}
                    </span>
                    {previewError ? (
                      <button
                        type="button"
                        onClick={() => loadPreview(clip, true)}
                        className="text-xs font-semibold text-white/70 underline-offset-4 transition hover:text-white"
                      >
                        Retry preview
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {clip.locked ? (
                      <button
                        type="button"
                        onClick={() => unlockClip(clip)}
                        disabled={clipAction !== "idle"}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-red-500/70 bg-red-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:border-white/25 disabled:bg-white/10 disabled:text-white/30"
                      >
                        {clipAction === "unlocking" ? "Unlocking…" : "Unlock (1 credit)"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => downloadClip(clip)}
                        disabled={clipAction !== "idle"}
                        className="inline-flex w-full items-center justify-center rounded-xl border border-red-500/70 bg-red-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:border-white/25 disabled:bg-white/10 disabled:text-white/30"
                      >
                        {clipAction === "downloading" ? "Preparing…" : "Download"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => loadPreview(clip, true)}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-sm font-semibold text-white"
                    >
                      Refresh Preview
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
