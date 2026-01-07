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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10">
      <header className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[32px] border border-black/10 bg-white/70 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.15)] backdrop-blur">
          <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.3em] text-orange-600">
            <span className="h-2 w-2 rounded-full bg-orange-500" />
            KangKlip
          </div>
          <h1 className="mt-4 font-display text-6xl leading-[0.92] text-slate-900">
            Clips that punch.
            <span className="block text-orange-600">GPU-fast.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600">
            Drop a long video URL and the Nosana pipeline carves out vertical highlights
            in under a minute. Script-first, deterministic, and ready for reels.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {["Deterministic", "Qwen2.5-3B", "3080 GPU", "R2 storage"].map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-[32px] border border-black/10 bg-slate-900 p-8 text-white shadow-[0_20px_60px_rgba(15,23,42,0.25)]">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-orange-300">
            Pipeline Snapshot
          </p>
          <div className="mt-6 grid gap-5 text-sm">
            {[
              "Download → Transcript",
              "LLM segment select",
              "FFmpeg render",
              "Upload + callback",
            ].map((item, index) => (
              <div key={item} className="flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-lg font-semibold">
                  0{index + 1}
                </span>
                <span className="text-base font-medium text-white/90">{item}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-white/60">
            Stateless jobs. One GPU per clip batch. No runtime installs.
          </p>
        </div>
      </header>

      <section className="rounded-[32px] border border-black/10 bg-white/80 p-8 shadow-[0_25px_70px_rgba(15,23,42,0.15)]">
        <div className="grid gap-6">
          <label className="grid gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
            Video URL
            <input
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-orange-400"
            />
          </label>
          <div className="grid gap-6 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
              Clip Duration
              <select
                value={clipDuration}
                onChange={(event) => setClipDuration(Number(event.target.value))}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base"
              >
                <option value={30}>30s</option>
                <option value={45}>45s</option>
                <option value={60}>60s</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
              Clip Count
              <select
                value={clipCount}
                onChange={(event) => setClipCount(Number(event.target.value))}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base"
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
              Language
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base"
              >
                <option value="auto">Auto</option>
                <option value="en">English</option>
                <option value="id">Bahasa</option>
              </select>
            </label>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
          <button
            onClick={submitJob}
            disabled={loading || !videoUrl}
            className="rounded-2xl bg-orange-500 px-6 py-4 text-lg font-semibold text-white shadow-lg transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading ? "Submitting..." : "Generate Clips"}
          </button>
        </div>
      </section>
    </main>
  );
}
