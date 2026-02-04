"use client";

import { useMemo } from "react";
import { clusterApiUrl } from "@solana/web3.js";
import {
  BackpackWalletAdapter,
  CoinbaseWalletAdapter,
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { AuthProvider } from "./providers/auth";

export default function Providers({ children }: { children: React.ReactNode }) {
  const endpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta");
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new BackpackWalletAdapter(),
      new CoinbaseWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AuthProvider>{children}</AuthProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
