"use client";

import { useState } from "react";
import WalletButton from "./components/wallet-button";

// Render the landing page with hero, CTA, copy, and FAQ.
export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 pb-28 pt-24">
      <header className="reveal stagger-1 fixed left-0 right-0 top-0 z-50">
        <div className="relative mx-auto flex w-full max-w-4xl items-center justify-between rounded-b-2xl border border-white/10 bg-black/90 px-4 py-3 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.9)] backdrop-blur">
          <div className="flex items-center gap-6">
            <a href="/" className="flex items-center gap-3">
              <svg viewBox="0 0 48 48" className="h-7 w-7" role="img" aria-label="KangKlip">
                <rect x="5" y="5" width="38" height="38" rx="10" fill="none" stroke="white" strokeWidth="2" />
                <rect x="14" y="13" width="8" height="22" fill="white" />
                <rect x="26" y="13" width="8" height="22" fill="#ff3b30" />
                <rect
                  x="10"
                  y="10"
                  width="28"
                  height="28"
                  fill="none"
                  stroke="#ff3b30"
                  strokeOpacity="0.45"
                  strokeWidth="1"
                />
              </svg>
              <span className="text-xs font-display tracking-[0.35em] text-white">KangKlip</span>
            </a>
            <nav className="hidden items-center gap-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/60 sm:flex">
              <a href="/generate-clips" className="transition hover:text-red-400">
                Generate Clips
              </a>
              <a href="/pricing" className="transition hover:text-red-400">
                Pricing
              </a>
              <a href="/topup" className="transition hover:text-red-400">
                Top Up
              </a>
              <a href="#faq" className="transition hover:text-red-400">
                FAQ
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
            {menuOpen ? "x" : "="}
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
                { label: "Generate Clips", href: "/generate-clips" },
                { label: "Pricing", href: "/pricing" },
                { label: "Top Up", href: "/topup" },
                { label: "FAQ", href: "#faq" },
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

      <section className="reveal stagger-2 border-y border-white/20 py-12">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="flex items-start gap-6">
              <span className="mt-2 h-14 w-[3px] bg-red-500" />
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/45">
                  Clip engine
                </p>
                <h1 className="text-4xl font-display tracking-wide text-white sm:text-5xl">
                  Cut long videos into <span className="text-red-400">high-quality</span> shorts.
                </h1>
              </div>
            </div>
            <p className="max-w-md text-sm text-white/65 sm:text-base">
              KangKlip finds hooks, extracts highlights, and renders fast. Cheap, fast, no sign-up,
              no watermark.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <a
                href="/generate-clips"
                className="inline-flex items-center justify-center gap-2 border border-red-500/80 bg-red-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-400"
              >
                Generate Clips
              </a>
              <a
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 border border-white/20 bg-black px-6 py-3 text-sm font-semibold text-white/80 transition hover:border-red-400/70 hover:text-white"
              >
                See Pricing
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em]">
              <span className="text-red-400">CHEAP</span>
              <span className="text-white/35">|</span>
              <span className="text-white/55">FAST</span>
              <span className="text-white/35">|</span>
              <span className="text-white/55">NO SIGN-UP</span>
              <span className="text-white/35">|</span>
              <span className="text-white/55">NO WATERMARK</span>
              <span className="text-white/35">|</span>
              <span className="text-white/55">HIGH QUALITY</span>
            </div>
          </div>

          <div className="space-y-4 border border-white/15 bg-black/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/55">
              Fast results
            </p>
            <div className="space-y-3 text-sm text-white/70">
              <p>One URL creates multiple clips in a single job.</p>
              <p>Auto-captions + 9:16 crop included.</p>
              <p>Preview first, pay only when you download.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-xs text-white/55">
              <span>High quality output</span>
              <span className="text-white/35">|</span>
              <span>No watermark</span>
              <span className="text-white/35">|</span>
              <span>No sign-up</span>
            </div>
          </div>
        </div>
      </section>

      <section className="reveal stagger-3">
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            {
              title: "Cheap & fast",
              body: "Pay per use. Fast renders with high-quality output and no watermark.",
            },
            {
              title: "No sign-up",
              body: "Just connect a wallet for credits. No account or email required.",
            },
            {
              title: "Preview first",
              body: "Watch previews for free, spend 1 credit only on download.",
            },
          ].map((item) => (
            <div key={item.title} className="border border-white/15 bg-black/70 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-red-400">
                {item.title}
              </p>
              <p className="mt-3 text-sm text-white/60">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="reveal stagger-4 border-y border-white/20 py-12">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <h2 className="text-2xl font-display text-white">Ready to start?</h2>
            <p className="text-sm text-white/60">
              Start with one URL. Top up credits, then download only the clips you want.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/generate-clips"
              className="inline-flex items-center justify-center gap-2 border border-red-500/80 bg-red-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-400"
            >
              Generate Clips
            </a>
            <a
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 border border-white/20 bg-black px-6 py-3 text-sm font-semibold text-white/80 transition hover:border-red-400/70 hover:text-white"
            >
              Pricing
            </a>
          </div>
        </div>
      </section>

      <section id="faq" className="reveal stagger-5">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-display text-white">FAQ</h2>
            <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/55">
              Quick answers
            </span>
          </div>
          <div className="grid gap-3">
            {[
              {
                q: "How much does generation cost?",
                a: "Each generate job costs 2 credits for transcript and processing.",
              },
              {
                q: "How much does a download cost?",
                a: "Each clip download costs 1 credit.",
              },
              {
                q: "Do credits expire?",
                a: "No. Credits never expire.",
              },
              {
                q: "Is there a watermark?",
                a: "No watermark is added to the output.",
              },
              {
                q: "Do I need to sign up?",
                a: "No account needed. Just connect a wallet to top up and unlock.",
              },
              {
                q: "Which URLs are supported?",
                a: "YouTube and direct video links. Invalid URLs are rejected by the backend.",
              },
              {
                q: "Can I preview before paying?",
                a: "Yes. Previews use short-lived URLs and do not spend credits.",
              },
              {
                q: "What is the output quality?",
                a: "High-quality renders with 9:16 crop and auto-captions.",
              },
              {
                q: "Where are files stored?",
                a: "Clips and artifacts are stored in R2 and delivered via signed URLs.",
              },
              {
                q: "How do I pay for credits?",
                a: "Top up with USDC using a Solana wallet.",
              },
            ].map((item) => (
              <details key={item.q} className="border border-white/15 bg-black/60 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white">
                  {item.q}
                </summary>
                <p className="mt-2 text-sm text-white/60">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="reveal stagger-6 border-t border-white/20 pt-8">
        <div className="flex flex-col gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(255,59,48,0.7)]" />
            <span className="font-display text-white">KangKlip</span>
          </div>
          <span>(c) 2026 KangKlip</span>
        </div>
      </footer>
    </main>
  );
}
