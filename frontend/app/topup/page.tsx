"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import WalletButton from "../components/wallet-button";
import { useAuth } from "../providers/auth";

type IntentResponse = {
  wallet_address: string;
  credits_to_buy: number;
  amount_base_units: number;
  credit_unit: number;
  program_id: string;
  config_pda: string;
  user_credit_pda: string;
  vault_ata: string;
  user_usdc_ata: string;
  usdc_mint: string;
  instruction_data: string;
};

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// Decode base64 instruction data from the backend.
const decodeBase64 = (value: string) => Buffer.from(value, "base64");

// Format USDC values for display.
const formatUsdc = (amount: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    amount
  );

// Render the credits top-up flow.
export default function TopupPage() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { authToken, status: authStatus } = useAuth();
  const [creditsInput, setCreditsInput] = useState("5");
  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "signing" | "confirming" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const creditsToBuy = Number(creditsInput);
  const isValidCredits = Number.isInteger(creditsToBuy) && creditsToBuy > 0;
  const usdcAmount = useMemo(() => (isValidCredits ? creditsToBuy * 0.1 : 0), [creditsToBuy, isValidCredits]);

  // Build auth headers for credit endpoints.
  const buildHeaders = useCallback(() => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authToken) {
      headers["x-auth-token"] = authToken;
    }
    return headers;
  }, [authToken]);

  // Fetch on-chain credit balance for the current wallet.
  const refreshBalance = useCallback(async () => {
    if (!authToken) {
      setBalance(null);
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/credits/balance`, {
        headers: buildHeaders(),
      });
      if (!response.ok) {
        throw new Error("Unable to fetch balance");
      }
      const payload = (await response.json()) as { credits: number };
      setBalance(payload.credits);
    } catch {
      setBalance(null);
    }
  }, [apiBase, authToken, buildHeaders]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  // Ask the backend for a pay_usdc instruction payload.
  const requestIntent = async () => {
    const response = await fetch(`${apiBase}/api/credits/topup/usdc/intent`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ credits_to_buy: creditsToBuy }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      throw new Error(payload?.detail || "Failed to request top up intent");
    }
    return payload as IntentResponse;
  };

  // Build the Anchor pay_usdc instruction from the backend payload.
  const buildInstruction = (intent: IntentResponse, walletAddress: PublicKey) => {
    return new TransactionInstruction({
      programId: new PublicKey(intent.program_id),
      keys: [
        { pubkey: walletAddress, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(intent.config_pda), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(intent.user_credit_pda), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(intent.user_usdc_ata), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(intent.vault_ata), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(intent.usdc_mint), isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: decodeBase64(intent.instruction_data),
    });
  };

  // Run the full top-up flow: intent -> sign -> confirm.
  const handleTopup = async () => {
    setError(null);
    setSignature(null);
    if (!publicKey || !connected) {
      setError("Connect your wallet first.");
      return;
    }
    if (!authToken) {
      setError("Wallet authentication pending. Try again once authenticated.");
      return;
    }
    if (!isValidCredits) {
      setError("Credits must be a positive whole number.");
      return;
    }
    try {
      setStatus("signing");
      const intent = await requestIntent();
      const instruction = buildInstruction(intent, publicKey);
      const transaction = new Transaction().add(instruction);
      transaction.feePayer = publicKey;
      const latestBlockhash = await connection.getLatestBlockhash();
      transaction.recentBlockhash = latestBlockhash.blockhash;
      const txSignature = await sendTransaction(transaction, connection);
      setSignature(txSignature);
      setStatus("confirming");
      await connection.confirmTransaction(txSignature, "confirmed");
      const confirmResponse = await fetch(`${apiBase}/api/credits/topup/usdc/confirm`, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ signature: txSignature }),
      });
      const confirmPayload = await confirmResponse.json().catch(() => null);
      if (!confirmResponse.ok) {
        throw new Error(confirmPayload?.detail || "Top up confirmation failed");
      }
      if (typeof confirmPayload?.new_balance === "number") {
        setBalance(confirmPayload.new_balance);
      } else {
        await refreshBalance();
      }
      setStatus("success");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Top up failed");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 pb-20 pt-24">
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
              <a href="/topup" className="text-red-400">
                Top Up
              </a>
            </nav>
          </div>
          <WalletButton />
        </div>
      </header>

      <section className="reveal stagger-2 mt-6 border-y border-white/20 py-10">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="flex items-start gap-6">
              <span className="mt-2 h-14 w-[3px] bg-red-500" />
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/45">
                  Credits
                </p>
                <h1 className="text-4xl font-display tracking-wide text-white sm:text-5xl">
                  Top up credits for <span className="text-red-400">instant</span> unlocks.
                </h1>
              </div>
            </div>
            <p className="max-w-md text-sm text-white/65 sm:text-base">
              Pay USDC once, then unlock clips directly from your job dashboard. Credits update on-chain.
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em]">
              <span className="text-red-400">Wallet</span>
              <span className="text-white/35">→</span>
              <span className="text-white/55">USDC</span>
              <span className="text-white/35">→</span>
              <span className="text-white/55">Credits</span>
            </div>
          </div>

          <div className="space-y-6 lg:border-l lg:border-white/20 lg:pl-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-display tracking-wide text-white">Current balance</h2>
              <p className="text-sm text-white/60">
                {authStatus === "ready" ? "Wallet authenticated." : "Connect wallet to read balance."}
              </p>
            </div>
            <div className="flex items-center justify-between border border-white/30 bg-black/70 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/55">Credits</p>
                <p className="text-3xl font-display text-white">
                  {balance === null ? "–" : balance}
                </p>
              </div>
              <button
                type="button"
                onClick={refreshBalance}
                className="border border-white/40 bg-black px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-red-400/70 hover:text-white"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="reveal stagger-3">
        <div className="grid gap-6 border border-white/25 bg-black/80 p-6 sm:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <h2 className="text-2xl font-display text-white">Buy credits</h2>
            <p className="text-sm text-white/60">
              1 credit = 0.10 USDC. Transactions settle on Solana and update your on-chain balance.
            </p>
            <div className="grid gap-2">
              <label className="text-xs font-normal uppercase tracking-[0.2em] text-white/55">
                Credits to buy
              </label>
              <input
                value={creditsInput}
                onChange={(event) => setCreditsInput(event.target.value)}
                className="border border-white/50 bg-black px-4 py-3 text-base text-white outline-none transition focus:border-red-500/80"
                placeholder="10"
                inputMode="numeric"
              />
              <p className="text-xs text-white/45">
                Estimated total: {formatUsdc(usdcAmount)} USDC
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-4">
            <div className="space-y-2 text-xs text-white/55">
              <p>Wallet must hold USDC on the selected network.</p>
              <p>Top ups are final once confirmed on-chain.</p>
            </div>
            <button
              type="button"
              onClick={handleTopup}
              disabled={!isValidCredits || status === "signing" || status === "confirming"}
              className="inline-flex w-full items-center justify-center gap-2 border border-red-500/80 bg-red-500 px-6 py-3 text-base font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:border-white/25 disabled:bg-white/10 disabled:text-white/30"
            >
              {status === "signing"
                ? "Waiting for wallet…"
                : status === "confirming"
                  ? "Confirming on-chain…"
                  : "Buy credits"}
            </button>
            {status === "success" ? (
              <p className="text-xs text-red-200">Top up confirmed.</p>
            ) : null}
            {error ? <p className="text-xs text-red-300">{error}</p> : null}
            {signature ? (
              <p className="text-[11px] text-white/45">Tx: {signature.slice(0, 8)}…</p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
