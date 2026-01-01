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
  download_url: string;
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

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header className="rounded-[32px] border border-black/10 bg-white/70 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.15)]">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
          Job Status
        </p>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">{jobId}</h1>
          <span className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold uppercase tracking-widest text-white">
            {status?.status ?? "Loading"}
          </span>
        </div>
        <p className="mt-3 text-slate-600">
          {status ? `Stage: ${status.stage ?? "Preparing"}` : "Loading..."}
        </p>
        {typeof status?.progress === "number" ? (
          <div className="mt-6 h-2 w-full rounded-full bg-slate-200">
            <div
              className="h-2 rounded-full bg-orange-500"
              style={{ width: `${status.progress}%` }}
            />
          </div>
        ) : null}
      </header>

      {error ? <p className="text-red-600">{error}</p> : null}

      <section className="rounded-[32px] border border-black/10 bg-white/80 p-8 shadow-[0_25px_70px_rgba(15,23,42,0.15)]">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Results</h2>
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
            Ready when done
          </span>
        </div>
        {!results ? (
          <p className="mt-4 text-slate-600">
            Clips will appear once the job finishes.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {results.clips.map((clip) => (
              <div
                key={clip.download_url}
                className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold">{clip.title}</p>
                  <span className="text-sm text-slate-500">{clip.duration}s</span>
                </div>
                <a
                  href={clip.download_url}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-orange-600"
                >
                  Download clip
                  <span aria-hidden>→</span>
                </a>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
