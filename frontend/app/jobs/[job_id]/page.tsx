"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type JobStatusResponse = {
  job_id: string;
  status: string;
  stage?: string;
  progress?: number;
  error?: string | null;
};

type ClipResult = {
  title: string;
  duration: number;
  file: string;
  download_url: string;
  stream_url: string;
};

type JobResultsResponse = {
  clips: ClipResult[];
};

export default function JobPage() {
  // Render job progress and results UI.
  const params = useParams();
  const jobId = params?.job_id as string;
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  const [status, setStatus] = useState<JobStatusResponse | null>(null);
  const [results, setResults] = useState<JobResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoFallback, setVideoFallback] = useState<Record<string, boolean>>({});
  const jobIdRef = useRef<string | null>(null);

  jobIdRef.current = jobId ?? null;

  useEffect(() => {
    if (!jobId) return;
    setStatus(null);
    setResults(null);
    setError(null);
  }, [jobId]);

  const loadResults = useCallback(async () => {
    // Load clip results and signed URLs.
    if (!jobId) return;
    const requestJobId = jobId;
    try {
      const response = await fetch(`${apiBase}/api/jobs/${jobId}/results`);
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
  }, [apiBase, jobId]);

  const loadStatus = useCallback(async () => {
    // Poll job status from the backend.
    if (!jobId) return;
    const requestJobId = jobId;
    try {
      const response = await fetch(`${apiBase}/api/jobs/${jobId}`);
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
      if (data.status === "SUCCEEDED" && !results) {
        await loadResults();
      }
    } catch (err) {
      if (jobIdRef.current !== requestJobId) {
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [apiBase, jobId, loadResults, results]);

  const isTerminal = status?.status === "SUCCEEDED" || status?.status === "FAILED";
  const shouldPoll = !isTerminal || (status?.status === "SUCCEEDED" && !results);

  useEffect(() => {
    // Start polling once the component mounts.
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

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 pb-10">
      <header className="reveal stagger-1 relative overflow-hidden rounded-3xl border border-white/10 bg-black/70 p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.85)] backdrop-blur">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-20 top-6 h-40 w-40 rounded-full bg-white/10 blur-[80px]" />
          <div className="absolute bottom-0 left-8 h-40 w-40 rounded-full bg-white/5 blur-[90px]" />
        </div>
        <div className="relative">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/55">
              Job Status
            </p>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/60">
              Live
            </span>
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

      <section className="reveal stagger-2 rounded-3xl border border-white/10 bg-black/60 p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.85)] backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Results</h2>
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/55">
            Ready when done
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
            {results.clips.map((clip, index) => (
              <div
                key={clip.file || `clip-${index}`}
                className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/50 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">
                    {clip.title || `Clip ${index + 1}`}
                  </p>
                  <span className="text-xs text-white/55">{clip.duration}s</span>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70">
                  <video
                    className="w-full max-h-[70vh] object-contain"
                    src={
                      videoFallback[clip.file]
                        ? `${apiBase}${clip.stream_url}`
                        : clip.download_url
                    }
                    controls
                    playsInline
                    preload="metadata"
                    onError={() =>
                      setVideoFallback((prev) => ({
                        ...prev,
                        [clip.file]: true,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <a
                    href={clip.download_url}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Open clip
                  </a>
                  <a
                    href={`${apiBase}${clip.stream_url}/download`}
                    download
                    className="inline-flex w-full items-center justify-center rounded-xl border border-red-500/70 bg-red-500 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
