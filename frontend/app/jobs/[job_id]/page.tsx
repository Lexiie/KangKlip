"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type JobStatusResponse = {
  job_id: string;
  status: string;
  stage?: string;
  progress?: number;
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

  const loadStatus = async () => {
    // Poll job status from the backend.
    try {
      const response = await fetch(`${apiBase}/api/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error("Failed to load job status");
      }
      const data = (await response.json()) as JobStatusResponse;
      setStatus(data);
      if (data.status === "SUCCEEDED") {
        await loadResults();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const loadResults = async () => {
    // Load clip results and signed URLs.
    try {
      const response = await fetch(`${apiBase}/api/jobs/${jobId}/results`);
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as JobResultsResponse;
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  useEffect(() => {
    // Start polling once the component mounts.
    if (!jobId) return;
    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [jobId]);

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
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-10">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
          Job Status
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white">
              {status?.status ?? "Loading"}
            </span>
            <span className="text-xs font-semibold text-slate-600">
              Stage: {status?.stage ?? "Preparing"}
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowFullId((prev) => !prev)}
                className="text-left text-xs font-semibold text-slate-700"
              >
                {showFullId ? "Hide Job ID" : "Show Job ID"}
              </button>
              <button
                type="button"
                onClick={copyJobId}
                className="text-xs font-semibold text-orange-600"
              >
                {copyStatus === "copied" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 break-all font-mono text-xs text-slate-600">
              {showFullId ? jobId : shortJobId}
            </p>
          </div>
        </div>

        {typeof status?.progress === "number" ? (
          <div className="mt-4 h-2 w-full rounded-full bg-slate-200">
            <div
              className="h-2 rounded-full bg-orange-500"
              style={{ width: `${status.progress}%` }}
            />
          </div>
        ) : null}
      </header>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Results</h2>
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400">
            Ready when done
          </span>
        </div>
        {!results ? (
          <p className="mt-3 text-sm text-slate-500">Clips will appear once the job finishes.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {results.clips.map((clip, index) => (
              <div
                key={clip.download_url}
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {clip.title || `Clip ${index + 1}`}
                  </p>
                  <span className="text-xs text-slate-500">{clip.duration}s</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <div className="aspect-[9/16] w-full">
                    <video
                      className="h-full w-full object-cover"
                      src={`${apiBase}${clip.stream_url}`}
                      controls
                      playsInline
                      preload="metadata"
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <a
                    href={clip.download_url}
                    className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                  >
                    Open clip
                  </a>
                  <a
                    href={clip.download_url}
                    download
                    className="inline-flex w-full items-center justify-center rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-600"
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
