import crypto from "crypto";
import fs from "fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

type ParsedInstruction = {
  program?: string;
  programId?: string;
  programIdIndex?: number;
  accounts?: number[];
  parsed?: {
    type?: string;
    info?: Record<string, unknown>;
    memo?: string;
  };
  data?: string;
};

type ParsedTransaction = {
  transaction?: {
    message?: {
      instructions?: ParsedInstruction[];
    };
  };
  meta?: {
    innerInstructions?: { instructions?: ParsedInstruction[] }[];
    err?: unknown;
  };
};

// Validates a base58 Solana public key string.
export const isValidPublicKey = (value: string): boolean => {
  try {
    const key = new PublicKey(value);
    return Boolean(key);
  } catch {
    return false;
  }
};

// Verifies a signed message against a wallet public key.
export const verifySignature = (
  walletAddress: string,
  message: string,
  signature: string
): boolean => {
  try {
    const publicKey = new PublicKey(walletAddress).toBytes();
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
  } catch {
    return false;
  }
};

// Fetches a parsed transaction from the Solana RPC.
export const fetchParsedTransaction = async (
  rpcUrl: string,
  signature: string
): Promise<ParsedTransaction | null> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Solana RPC error ${response.status}`);
  }
  const payload = (await response.json()) as { result?: ParsedTransaction | null };
  return payload.result ?? null;
};

// Fetches raw account data from the Solana RPC.
export const fetchAccountData = async (
  rpcUrl: string,
  account: string
): Promise<Buffer | null> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [account, { encoding: "base64" }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Solana RPC error ${response.status}`);
  }
  const payload = (await response.json()) as {
    result?: { value?: { data?: [string, string] } };
  };
  const data = payload.result?.value?.data?.[0];
  if (!data) {
    return null;
  }
  return Buffer.from(data, "base64");
};

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export const getAssociatedTokenAddress = (wallet: string, mint: string): string => {
  const walletKey = new PublicKey(wallet);
  const mintKey = new PublicKey(mint);
  const [address] = PublicKey.findProgramAddressSync(
    [walletKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintKey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return address.toBase58();
};

const collectInstructions = (tx: ParsedTransaction): ParsedInstruction[] => {
  const instructions: ParsedInstruction[] = [];
  const messageInstructions = tx.transaction?.message?.instructions ?? [];
  instructions.push(...messageInstructions);
  const inner = tx.meta?.innerInstructions ?? [];
  for (const entry of inner) {
    if (entry.instructions) {
      instructions.push(...entry.instructions);
    }
  }
  return instructions;
};

// Checks for a memo instruction with exact memo text.
export const hasMemo = (tx: ParsedTransaction, memo: string): boolean => {
  const instructions = collectInstructions(tx);
  for (const instruction of instructions) {
    if (instruction.program === "spl-memo") {
      const parsedMemo = instruction.parsed?.memo;
      if (parsedMemo === memo) {
        return true;
      }
    }
  }
  return false;
};

// Checks whether a transaction invoked a given program.
export const hasProgramInstruction = (tx: ParsedTransaction, programId: string): boolean => {
  const instructions = collectInstructions(tx);
  for (const instruction of instructions) {
    if (instruction.programId && instruction.programId === programId) {
      return true;
    }
    if (instruction.program && instruction.program === programId) {
      return true;
    }
  }
  return false;
};

// Decodes the UserCredit PDA account.
export const decodeUserCreditAccount = (data: Buffer): { user: string; credits: bigint } | null => {
  const discriminator = crypto
    .createHash("sha256")
    .update("account:UserCredit")
    .digest()
    .subarray(0, 8);
  if (data.length < 8 + 32 + 8 + 1) {
    return null;
  }
  if (!data.subarray(0, 8).equals(discriminator)) {
    return null;
  }
  const user = new PublicKey(data.subarray(8, 40)).toBase58();
  const credits = data.readBigUInt64LE(40);
  return { user, credits };
};

// Loads a keypair from a JSON file path or JSON array string.
export const loadKeypair = (source: string): Keypair => {
  const raw = source.trim();
  let json = raw;
  if (!raw.startsWith("[")) {
    json = fs.readFileSync(raw, "utf-8");
  }
  const values = JSON.parse(json) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(values));
};

export const totalUsdcTransferred = (
  tx: ParsedTransaction,
  walletAddress: string,
  treasuryAddress: string,
  usdcMint: string
): bigint => {
  const instructions = collectInstructions(tx);
  const walletAta = getAssociatedTokenAddress(walletAddress, usdcMint);
  const treasuryAta = getAssociatedTokenAddress(treasuryAddress, usdcMint);
  let total = 0n;
  for (const instruction of instructions) {
    if (instruction.program !== "spl-token") {
      continue;
    }
    const info = instruction.parsed?.info ?? {};
    const source = String(info.source ?? "");
    const destination = String(info.destination ?? "");
    const mint = String(info.mint ?? "");
    const authority = String(info.authority ?? "");
    if (!source || !destination || !mint) {
      continue;
    }
    const walletMatch = source === walletAta || authority === walletAddress;
    const treasuryMatch = destination === treasuryAta || destination === treasuryAddress;
    if (!walletMatch || !treasuryMatch || mint !== usdcMint) {
      continue;
    }
    const amountRaw = info.amount ?? (info.tokenAmount as Record<string, unknown> | undefined)?.amount;
    if (!amountRaw) {
      continue;
    }
    try {
      const amount = BigInt(String(amountRaw));
      total += amount;
    } catch {
      continue;
    }
  }
  return total;
};
