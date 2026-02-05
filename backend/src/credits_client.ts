import crypto from "crypto";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const CREDIT_UNIT = 100000;

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

// Anchor instruction discriminator (first 8 bytes of sha256(name)).
const anchorDiscriminator = (name: string): Buffer => {
  return crypto.createHash("sha256").update(name).digest().subarray(0, 8);
};

// Derive the config PDA from authority.
export const deriveConfigPda = (authority: PublicKey, programId: PublicKey): PublicKey => {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config"), authority.toBuffer()],
    programId
  );
  return pda;
};

// Derive the user credit PDA from wallet.
export const deriveUserCreditPda = (user: PublicKey, programId: PublicKey): PublicKey => {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("credit"), user.toBuffer()],
    programId
  );
  return pda;
};

// Derive an ATA for a given owner + mint.
export const deriveAssociatedTokenAddress = (owner: PublicKey, mint: PublicKey): PublicKey => {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
};

// Build Anchor instruction data for pay_usdc.
export const buildPayUsdcInstructionData = (amountBaseUnits: bigint): Buffer => {
  const discriminator = anchorDiscriminator("global:pay_usdc");
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(amountBaseUnits);
  return Buffer.concat([discriminator, amountBuffer]);
};

// Build Anchor instruction data for consume_credit.
export const buildConsumeCreditInstructionData = (amount: bigint): Buffer => {
  const discriminator = anchorDiscriminator("global:consume_credit");
  const amountBuffer = Buffer.alloc(8);
  amountBuffer.writeBigUInt64LE(amount);
  return Buffer.concat([discriminator, amountBuffer]);
};

// Build a full pay_usdc transaction instruction.
export const buildPayUsdcInstruction = (params: {
  programId: PublicKey;
  user: PublicKey;
  config: PublicKey;
  userCredit: PublicKey;
  userUsdc: PublicKey;
  vaultUsdc: PublicKey;
  usdcMint: PublicKey;
  amountBaseUnits: bigint;
}): TransactionInstruction => {
  const data = buildPayUsdcInstructionData(params.amountBaseUnits);
  return new TransactionInstruction({
    programId: params.programId,
    data,
    keys: [
      { pubkey: params.user, isSigner: true, isWritable: true },
      { pubkey: params.config, isSigner: false, isWritable: true },
      { pubkey: params.userCredit, isSigner: false, isWritable: true },
      { pubkey: params.userUsdc, isSigner: false, isWritable: true },
      { pubkey: params.vaultUsdc, isSigner: false, isWritable: true },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
};

// Build a full consume_credit transaction instruction.
export const buildConsumeCreditInstruction = (params: {
  programId: PublicKey;
  spender: PublicKey;
  config: PublicKey;
  user: PublicKey;
  userCredit: PublicKey;
  amount: bigint;
}): TransactionInstruction => {
  const data = buildConsumeCreditInstructionData(params.amount);
  return new TransactionInstruction({
    programId: params.programId,
    data,
    keys: [
      { pubkey: params.spender, isSigner: true, isWritable: true },
      { pubkey: params.config, isSigner: false, isWritable: false },
      { pubkey: params.user, isSigner: false, isWritable: false },
      { pubkey: params.userCredit, isSigner: false, isWritable: true },
    ],
  });
};
