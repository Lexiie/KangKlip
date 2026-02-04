"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "../providers/auth";

const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export default function WalletButton() {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const { status } = useAuth();

  const label = connecting
    ? "Connecting"
    : connected && publicKey
      ? shortAddress(publicKey.toBase58())
      : "Connect Wallet";

  return (
    <button
      type="button"
      onClick={() => {
        if (connected) {
          disconnect().catch(() => undefined);
          return;
        }
        setVisible(true);
      }}
      className="inline-flex items-center gap-2 border border-white/20 bg-black px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:border-red-400/70 hover:text-white"
    >
      <span>{label}</span>
      {connected ? (
        <span className="text-[10px] text-red-400">
          {status === "ready" ? "AUTH" : "VERIFY"}
        </span>
      ) : null}
    </button>
  );
}
