#!/usr/bin/env bash
set -e

export CARGO_UNSTABLE_NEXT_LOCKFILE_BUMP=false

solana config set --keypair /root/.config/solana/id.json
solana config set --url "$SOLANA_RPC_URL"

mkdir -p target/deploy
solana-keygen new -o target/deploy/kangklip_credits-keypair.json --no-bip39-passphrase --force
PROGRAM_ID=$(solana address -k target/deploy/kangklip_credits-keypair.json)
echo "Program ID: $PROGRAM_ID"

sed -i "s/declare_id!(\"[^\"]*\")/declare_id!(\"$PROGRAM_ID\")/" programs/kangklip_credits/src/lib.rs
sed -i "s/kangklip_credits = \"[^\"]*\"/kangklip_credits = \"$PROGRAM_ID\"/" Anchor.toml

anchor build
anchor deploy
