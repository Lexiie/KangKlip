export const metadata = {
  title: "Terms & Conditions | KangKlip",
  description: "KangKlip terms and conditions for credits and service use.",
};

// Render the Terms & Conditions page.
export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-12 pb-28 pt-24">
      <header className="reveal stagger-1 fixed left-0 right-0 top-0 z-50">
        <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-b-2xl border border-white/10 bg-black/90 px-4 py-3 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.9)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
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
          <nav className="flex flex-wrap items-center gap-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/60">
            <a href="/generate-clips" className="transition hover:text-red-400">
              Generate Clips
            </a>
            <a href="/pricing" className="transition hover:text-red-400">
              Pricing
            </a>
            <a href="/topup" className="transition hover:text-red-400">
              Top Up
            </a>
          </nav>
        </div>
      </header>

      <section className="reveal stagger-2 border-y border-white/20 py-12">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/45">
              Terms & Conditions
            </p>
            <h1 className="text-3xl font-display text-white sm:text-4xl">Know the rules.</h1>
            <p className="text-sm text-white/60 sm:text-base">
              By using KangKlip, you agree to the terms below. These terms apply to all usage of
              the service and credit purchases.
            </p>
          </div>
          <div className="space-y-3 text-sm text-white/60">
            <p>
              The service may evolve over time, but we aim to keep pricing, output quality, and
              processing expectations transparent.
            </p>
            <p>
              If you do not agree with these terms, please do not use KangKlip or purchase credits.
            </p>
          </div>
        </div>
      </section>

      <section className="reveal stagger-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="border border-white/15 bg-black/60 p-4">
            <h2 className="text-sm font-semibold text-white">Credits & Payments</h2>
            <ul className="mt-2 list-disc space-y-2 text-sm text-white/60">
              <li>Credits are non-refundable once purchased.</li>
              <li>Credits are applied per successful render job.</li>
              <li>Unused credits remain in your balance until spent.</li>
            </ul>
          </div>
          <div className="border border-white/15 bg-black/60 p-4">
            <h2 className="text-sm font-semibold text-white">Usage</h2>
            <ul className="mt-2 list-disc space-y-2 text-sm text-white/60">
              <li>Only submit content you have the right to process.</li>
              <li>Do not use KangKlip for unlawful or harmful content.</li>
              <li>Respect third-party platform policies when exporting clips.</li>
            </ul>
          </div>
          <div className="border border-white/15 bg-black/60 p-4">
            <h2 className="text-sm font-semibold text-white">Service Access</h2>
            <ul className="mt-2 list-disc space-y-2 text-sm text-white/60">
              <li>Availability can change based on GPU capacity and demand.</li>
              <li>We may update features or workflows to improve quality.</li>
            </ul>
          </div>
          <div className="border border-white/15 bg-black/60 p-4">
            <h2 className="text-sm font-semibold text-white">Deliverables</h2>
            <ul className="mt-2 list-disc space-y-2 text-sm text-white/60">
              <li>Generated clips are delivered via secure download links.</li>
              <li>Download links may expire for security reasons.</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="reveal stagger-4 border-t border-white/20 pt-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(255,59,48,0.7)]" />
              <span className="font-display text-white">KangKlip</span>
            </div>
            <div className="space-y-2">
              <p className="text-base font-display tracking-wide text-white sm:text-lg">
                Lightning-fast <span className="text-red-400">AI clipper</span> for long-form video.
              </p>
              <p className="max-w-2xl text-xs font-medium leading-relaxed text-white/55">
                KangKlip scans your source, isolates high-engagement moments, reframes to 9:16, and
                delivers ready-to-post shorts in minutes. Paste a link, set duration, deploy.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/50">
              <a href="/legal" className="transition hover:text-red-400">
                Legal
              </a>
              <a href="/about" className="transition hover:text-red-400">
                About
              </a>
              <a href="/terms" className="transition hover:text-red-400">
                Terms
              </a>
            </div>
          </div>
          <div className="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">
            (c) 2026 KangKlip
          </div>
        </div>
      </footer>
    </main>
  );
}
