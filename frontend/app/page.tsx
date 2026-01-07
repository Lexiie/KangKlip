"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type JobResponse = {
  job_id: string;
  status: string;
};

export default function HomePage() {
  // Render the landing page with job submission form.
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState("");
  const [clipDuration, setClipDuration] = useState(45);
  const [clipCount, setClipCount] = useState(2);
  const [language, setLanguage] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  const backendStatus = apiBase ? "Connected" : "Disconnected";

  const submitJob = async () => {
    // Submit the job to the backend API.
    setLoading(true);
    setError(null);
    setHint(null);
    const useNoCors = process.env.NEXT_PUBLIC_FETCH_NO_CORS === "true";
    try {
      const response = await fetch(`${apiBase}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoUrl,
          clip_duration_seconds: clipDuration,
          clip_count: clipCount,
          language,
        }),
        mode: useNoCors ? "no-cors" : "cors",
      });
      if (useNoCors || response.type === "opaque") {
        setHint("Request sent in no-cors mode. Check backend logs for job creation.");
        return;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to create job");
      }
      const data = (await response.json()) as JobResponse;
      router.push(`/jobs/${data.job_id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setHint(
        `Cannot reach backend. Check NEXT_PUBLIC_API_BASE (current: ${apiBase || "<empty>"}) and that backend is running.`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-28">
      <header className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-orange-500" />
          <span className="text-sm font-semibold text-slate-900">KangKlip</span>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            backendStatus === "Connected"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-slate-200 text-slate-600"
          }`}
        >
          Backend: {backendStatus}
        </span>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-slate-900">Generate Clips</h1>
          <p className="text-sm text-slate-500">Build short clips directly from a video URL.</p>
        </div>

        <div className="grid gap-5">
          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            Video URL
            <input
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none transition focus:border-orange-400"
              disabled={loading}
            />
            <span className="text-xs text-slate-400">Supports YouTube and direct video links.</span>
          </label>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <span className="text-sm font-semibold text-slate-700">Clip Duration</span>
              <div className="flex gap-2">
                {[30, 45, 60].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setClipDuration(value)}
                    disabled={loading}
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                      clipDuration === value
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-slate-200 bg-white text-slate-600 hover:border-orange-300"
                    }`}
                  >
                    {value}s
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <span className="text-sm font-semibold text-slate-700">Clip Count</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setClipCount((count) => Math.max(1, count - 1))}
                  disabled={loading || clipCount <= 1}
                  className="h-10 w-10 rounded-xl border border-slate-200 text-lg font-semibold text-slate-600 disabled:cursor-not-allowed"
                >
                  -
                </button>
                <span className="min-w-[2rem] text-center text-base font-semibold text-slate-900">
                  {clipCount}
                </span>
                <button
                  type="button"
                  onClick={() => setClipCount((count) => Math.min(5, count + 1))}
                  disabled={loading || clipCount >= 5}
                  className="h-10 w-10 rounded-xl border border-slate-200 text-lg font-semibold text-slate-600 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
            </div>

            <label className="grid gap-2 text-sm font-semibold text-slate-700">
              Language
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-base"
                disabled={loading}
              >
                <option value="auto">Auto</option>
                <option value="en">English</option>
                <option value="id">Bahasa</option>
              </select>
            </label>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-semibold">Request failed. Check backend URL and CORS/origin.</p>
              <p className="text-xs text-red-500">{error}</p>
            </div>
          ) : null}
          {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
        </div>
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">Pipeline</summary>
        <ol className="mt-3 grid gap-2 text-sm text-slate-600">
          {["Download", "Transcript", "Segment Select", "Render", "Upload"].map((step, index) => (
            <li key={step} className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </details>

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <button
          onClick={submitJob}
          disabled={loading || !videoUrl}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Submitting...
            </span>
          ) : (
            "Generate Clips"
          )}
        </button>
      </div>
    </main>
  );
}
