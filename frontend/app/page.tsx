"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WalletButton from "./components/wallet-button";
import { storeJobToken } from "./lib/jobToken";

type JobResponse = {
  job_id: string;
  job_token: string;
  status: string;
};

export default function HomePage() {
  // Render the landing page with job submission form.
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState("");
  const [clipDuration, setClipDuration] = useState(45);
  const [clipCount, setClipCount] = useState(2);
  const [language] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
      if (data.job_token) {
        storeJobToken(data.job_id, data.job_token);
      }
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
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-28 pt-24">
      <header className="reveal stagger-1 fixed left-0 right-0 top-0 z-50">
        <div className="relative mx-auto flex w-full max-w-4xl items-center justify-between rounded-b-2xl border border-white/10 bg-black/90 px-4 py-3 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.9)] backdrop-blur">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <svg
                viewBox="0 0 48 48"
                className="h-7 w-7"
                role="img"
                aria-label="KangKlip"
              >
                <rect
                  x="5"
                  y="5"
                  width="38"
                  height="38"
                  rx="10"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                />
                <rect x="14" y="13" width="8" height="22" fill="white" />
                <rect x="26" y="13" width="8" height="22" fill="#ff3b30" />
                <rect x="10" y="10" width="28" height="28" fill="none" stroke="#ff3b30" strokeOpacity="0.45" strokeWidth="1" />
              </svg>
              <span className="text-xs font-display tracking-[0.35em] text-white">KangKlip</span>
            </div>
            <nav className="hidden items-center gap-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/60 sm:flex">
              <a href="#builder" className="transition hover:text-red-400">
                Builder
              </a>
              <a href="/topup" className="transition hover:text-red-400">
                Top Up
              </a>
            </nav>
          </div>
          <div className="hidden sm:inline-flex">
            <WalletButton />
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-semibold uppercase tracking-[0.25em] text-white/70 sm:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="Toggle navigation"
          >
            {menuOpen ? "×" : "≡"}
          </button>
          {menuOpen ? (
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm"
              aria-label="Close navigation"
            />
          ) : null}
          <div
            id="mobile-nav"
            className={`absolute left-0 right-0 top-full z-50 mt-2 origin-top rounded-2xl border border-white/15 bg-black/95 p-4 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.9)] transition duration-300 sm:hidden ${
              menuOpen
                ? "pointer-events-auto translate-y-0 opacity-100"
                : "pointer-events-none -translate-y-2 opacity-0"
            }`}
            aria-hidden={!menuOpen}
        >
          <nav className="grid gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-white/70">
            {[
              { label: "Builder", href: "#builder" },
              { label: "Top Up", href: "/topup" },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                tabIndex={menuOpen ? 0 : -1}
                className="border-b border-white/15 pb-2 transition hover:text-red-400"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 sm:hidden">
            <WalletButton />
          </div>
        </div>
        </div>
      </header>

      <section id="builder" className="reveal stagger-2 border-y border-white/20 py-12">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-10">
            <div className="flex items-start gap-6">
              <span className="mt-2 h-14 w-[3px] bg-red-500" />
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/45">
                  Short-form engine
                </p>
                <h1 className="text-4xl font-display tracking-wide text-white sm:text-5xl">
                  Turn long videos into <span className="text-red-400">sharp</span> clips.
                </h1>
              </div>
            </div>
            <p className="max-w-md text-sm text-white/65 sm:text-base">
              Paste a URL, set duration and count, and ship short cuts in one run.
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em]">
              <span className="text-red-400">1. URL IN</span>
              <span className="text-white/35">→</span>
              <span className="text-white/55">2. CLIPS OUT</span>
              <span className="text-white/35">→</span>
              <span className="text-white/55">3. AUTO-CAPTION</span>
            </div>
          </div>

          <div className="lg:border-l lg:border-white/20 lg:pl-8">
            <div className="space-y-3">
              <h2 className="text-2xl font-display tracking-wide text-white">
                Paste your video URL
              </h2>
              <p className="text-sm text-white/60">
                Choose duration and clip count.
              </p>
            </div>

            <div className="mt-8 border border-white/40 bg-black/80 p-6">
              <label className="grid gap-2 text-xs font-normal uppercase tracking-[0.2em] text-white/55">
                Video URL
                <input
                  value={videoUrl}
                  onChange={(event) => setVideoUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="border border-white/50 bg-black px-4 py-3 text-base text-white outline-none transition focus:border-red-500/80"
                  disabled={loading}
                />
                <span className="text-[11px] text-white/45">
                  Supports YouTube and direct links.
                </span>
              </label>

              <div className="mt-8 grid gap-6 border-t border-white/25 pt-6">
                <div className="grid gap-2">
                  <span className="text-xs font-normal uppercase tracking-[0.2em] text-white/55">
                    Clip Duration
                  </span>
                  <div className="flex gap-3">
                    {[30, 45, 60].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setClipDuration(value)}
                        disabled={loading}
                        className={`flex-1 border px-3 py-3 text-base font-normal transition ${
                          clipDuration === value
                            ? "border-red-500/70 bg-red-500/10 text-white"
                            : "border-white/40 bg-black text-white/70 hover:border-red-400/60 hover:text-white"
                        }`}
                      >
                        {value}s
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <span className="text-xs font-normal uppercase tracking-[0.2em] text-white/55">
                    Clip Count
                  </span>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setClipCount((count) => Math.max(1, count - 1))}
                      disabled={loading || clipCount <= 1}
                      className="h-10 w-10 border border-white/40 bg-black text-base font-normal text-white/80 transition hover:border-red-400/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      -
                    </button>
                    <span className="min-w-[2rem] text-center text-base font-semibold text-white">
                      {clipCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setClipCount((count) => Math.min(5, count + 1))}
                      disabled={loading || clipCount >= 5}
                      className="h-10 w-10 border border-white/40 bg-black text-base font-normal text-white/80 transition hover:border-red-400/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <input type="hidden" value={language} readOnly />

              {error ? (
                <div className="mt-6 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  <p className="font-semibold">Request failed. Check backend URL and CORS/origin.</p>
                  <p className="text-xs text-red-300/80">{error}</p>
                </div>
              ) : null}
              {hint ? <p className="mt-3 text-xs text-white/45">{hint}</p> : null}

              <button
                onClick={submitJob}
                disabled={loading || !videoUrl}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 border border-red-500/80 bg-red-500 px-6 py-3 text-base font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:border-white/25 disabled:bg-white/10 disabled:text-white/30"
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
              <p className="mt-3 text-xs text-white/55">
                Runs as a single GPU job.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="reveal stagger-3 border-t border-white/20 pt-8">
        <div className="flex flex-col gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(255,59,48,0.7)]" />
            <span className="font-display text-white">KangKlip</span>
          </div>
          <span>© 2026 KangKlip</span>
        </div>
      </footer>

    </main>
  );
}
