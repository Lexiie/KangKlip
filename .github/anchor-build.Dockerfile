FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV SOLANA_VERSION=v2.3.13
ENV ANCHOR_VERSION=0.31.1
ENV CARGO_UNSTABLE_NEXT_LOCKFILE_BUMP=false
ENV PATH="/root/.cargo/bin:/root/.local/share/solana/install/active_release/bin:${PATH}"

RUN apt-get update && apt-get install -y \
    curl build-essential pkg-config libssl-dev libudev-dev git \
    && rm -rf /var/lib/apt/lists/*

# Rust (1.85+ required for edition2024)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.85
ENV PATH="/root/.cargo/bin:${PATH}"

# Solana (Agave 2.x — no io_uring dependency)
RUN sh -c "$(curl -sSfL https://release.anza.xyz/${SOLANA_VERSION}/install)"

# Anchor CLI (compile from source for GLIBC compatibility)
RUN cargo install --git https://github.com/coral-xyz/anchor --tag v${ANCHOR_VERSION} anchor-cli --locked
