"use client";

import { useState } from "react";
import WalletButton from "../components/wallet-button";

// Render pricing details for credits and usage.
export default function PricingPage() {
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
              <a href="/" className="transition hover:text-red-400">
                Home
              </a>
              <a href="/generate-clips" className="transition hover:text-red-400">
                Generate Clips
              </a>
              <a href="/topup" className="transition hover:text-red-400">
                Top Up
              </a>
              <a href="/pricing" className="text-red-400">
                Pricing
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
                { label: "Home", href: "/" },
                { label: "Generate Clips", href: "/generate-clips" },
                { label: "Top Up", href: "/topup" },
                { label: "Pricing", href: "/pricing" },
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
                  Pricing
                </p>
                <h1 className="text-4xl font-display tracking-wide text-white sm:text-5xl">
                  Simple credits. <span className="text-red-400">No</span> expiry.
                </h1>
              </div>
            </div>
            <p className="max-w-md text-sm text-white/65 sm:text-base">
              Every action is priced in credits so you only pay for what you use. Credits never
              expire.
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em]">
              <span className="text-red-400">2 CREDITS</span>
              <span className="text-white/35">-&gt;</span>
              <span className="text-white/55">GENERATE</span>
              <span className="text-white/35">-&gt;</span>
              <span className="text-white/55">1 CREDIT DOWNLOAD</span>
            </div>
          </div>

          <div className="space-y-4 border border-white/15 bg-black/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/55">
              What you pay for
            </p>
            <div className="space-y-3 text-sm text-white/70">
              <p>
                Generate clips: <span className="text-white">2 credits</span> per job (covers
                transcript + processing).
              </p>
              <p>
                Download clip: <span className="text-white">1 credit</span> per clip.
              </p>
              <p>
                Credits: <span className="text-white">never expire</span>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4 text-xs text-white/55">
              <span>On-chain balance</span>
              <span className="text-white/35">|</span>
              <span>Unlock only what you need</span>
            </div>
          </div>
        </div>
      </section>

      <section className="reveal stagger-3">
        <div className="grid gap-6 lg:grid-cols-3">
          {[
            {
              title: "Transcript & processing",
              body: "Every generate-clips run includes transcript, chunking, and selection costs.",
            },
            {
              title: "Pay per download",
              body: "Only spend credits when you download the clip you want.",
            },
            {
              title: "No expiration",
              body: "Credits never expire so you can top up once and use later.",
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
            <h2 className="text-2xl font-display text-white">Need credits?</h2>
            <p className="text-sm text-white/60">
              Top up once and use credits whenever you want. No expiry.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/topup"
              className="inline-flex items-center justify-center gap-2 border border-red-500/80 bg-red-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-400"
            >
              Top Up Credits
            </a>
            <a
              href="/generate-clips"
              className="inline-flex items-center justify-center gap-2 border border-white/20 bg-black px-6 py-3 text-sm font-semibold text-white/80 transition hover:border-red-400/70 hover:text-white"
            >
              Generate Clips
            </a>
          </div>
        </div>
      </section>

      <footer className="reveal stagger-5 border-t border-white/20 pt-8">
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
