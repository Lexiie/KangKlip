"use client";

import bs58 from "bs58";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

type AuthState = {
  authToken: string | null;
  walletAddress: string | null;
  status: "idle" | "authenticating" | "ready" | "error";
  error: string | null;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const { publicKey, connected, signMessage } = useWallet();
  // Keep auth token in memory only; do not persist to storage.
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const walletRef = useRef<string | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  const walletAddress = publicKey?.toBase58() ?? null;

  const refresh = useCallback(async () => {
    if (!walletAddress || !signMessage) {
      setStatus("error");
      setError("Wallet does not support message signing.");
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    const requestWallet = walletAddress;
    setStatus("authenticating");
    setError(null);
    try {
      const challengeRes = await fetch(`${apiBase}/api/auth/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: walletAddress }),
      });
      if (!challengeRes.ok) {
        const text = await challengeRes.text();
        throw new Error(text || "Failed to request challenge");
      }
      const challengePayload = (await challengeRes.json()) as {
        challenge: string;
        nonce: string;
      };
      const signature = await signMessage(new TextEncoder().encode(challengePayload.challenge));
      const verifyRes = await fetch(`${apiBase}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: walletAddress,
          nonce: challengePayload.nonce,
          signature: bs58.encode(signature),
        }),
      });
      if (!verifyRes.ok) {
        const text = await verifyRes.text();
        throw new Error(text || "Failed to verify signature");
      }
      const verifyPayload = (await verifyRes.json()) as { auth_token: string };
      if (walletRef.current !== requestWallet) {
        return;
      }
      setAuthToken(verifyPayload.auth_token);
      setStatus("ready");
    } catch (err) {
      if (walletRef.current !== requestWallet) {
        return;
      }
      setAuthToken(null);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Auth failed");
    } finally {
      inFlight.current = false;
    }
  }, [apiBase, signMessage, walletAddress]);

  useEffect(() => {
    walletRef.current = walletAddress;
    if (!connected || !walletAddress) {
      setAuthToken(null);
      setStatus("idle");
      setError(null);
      return;
    }
    setAuthToken(null);
    setError(null);
    refresh();
  }, [connected, refresh, walletAddress]);

  return (
    <AuthContext.Provider value={{ authToken, walletAddress, status, error, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};
