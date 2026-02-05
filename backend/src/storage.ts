import { createClient } from "redis";

// JSON payload for job state storage.
export type JobRecord = Record<string, unknown> & {
  job_token?: string;
};

// Redis-backed storage for job state.
export class JobStore {
  private client;

  // Initializes the Redis client.
  constructor(redisUrl: string) {
    this.client = createClient({ url: redisUrl });
  }

  // Connects to Redis.
  async connect(): Promise<void> {
    await this.client.connect();
  }

  // Fetches a job record by id.
  async get(jobId: string): Promise<JobRecord | null> {
    const raw = await this.client.get(jobId);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as JobRecord;
    } catch {
      return null;
    }
  }

  // Stores a job record by id.
  async set(jobId: string, payload: JobRecord): Promise<void> {
    await this.client.set(jobId, JSON.stringify(payload));
  }

  // Merges updates into the existing job record.
  async update(jobId: string, updates: JobRecord): Promise<void> {
    const current = (await this.get(jobId)) || {};
    await this.set(jobId, { ...current, ...updates });
  }

  // Checks whether a clip has been unlocked for a job.
  async isClipUnlocked(jobId: string, clipFile: string): Promise<boolean> {
    const key = `ent:${jobId}:${clipFile}`;
    const value = await this.client.get(key);
    return value === "1";
  }

  // Marks a clip as unlocked.
  async setClipUnlocked(jobId: string, clipFile: string): Promise<void> {
    const key = `ent:${jobId}:${clipFile}`;
    await this.client.set(key, "1");
  }

  // Atomically records a credit spend for unlock idempotency.
  async consumeCredit(
    jobId: string,
    clipFile: string,
    walletAddress: string,
    unlockRequestId: string,
    availableCredits: number,
    ttlSeconds = 300
  ): Promise<
    | { unlocked: true; chargedCredits: number; idempotency: "NEW" | "REPLAY" }
    | { unlocked: false; reason: "INSUFFICIENT_CREDITS" }
  > {
    const entKey = `ent:${jobId}:${clipFile}`;
    const spentKey = `spent:${walletAddress}`;
    const idemKey = `idem:${unlockRequestId}`;
    const script = `
      local entKey = KEYS[1]
      local spentKey = KEYS[2]
      local idemKey = KEYS[3]
      local jobId = ARGV[1]
      local clipFile = ARGV[2]
      local wallet = ARGV[3]
      local available = tonumber(ARGV[4]) or 0
      local ttl = tonumber(ARGV[5]) or 300

      local idem = redis.call("GET", idemKey)
      if idem then
        return {"REPLAY", idem}
      end

      if redis.call("GET", entKey) == "1" then
        local payload = cjson.encode({
          job_id = jobId,
          clip_file = clipFile,
          unlocked = true,
          charged_credits = 0,
          idempotency = "REPLAY"
        })
        redis.call("SET", idemKey, payload, "EX", ttl, "NX")
        return {"REPLAY", payload}
      end

      local spent = tonumber(redis.call("GET", spentKey) or "0")
      if (spent + 1) > available then
        return {"INSUFFICIENT_CREDITS"}
      end

      redis.call("INCRBY", spentKey, 1)
      redis.call("SET", entKey, "1")
      local payload = cjson.encode({
        job_id = jobId,
        clip_file = clipFile,
        wallet = wallet,
        unlocked = true,
        charged_credits = 1,
        idempotency = "NEW"
      })
      redis.call("SET", idemKey, payload, "EX", ttl, "NX")
      return {"NEW", payload}
    `;
    const result = (await this.client.eval(script, {
      keys: [entKey, spentKey, idemKey],
      arguments: [
        jobId,
        clipFile,
        walletAddress,
        String(availableCredits),
        String(ttlSeconds),
      ],
    })) as unknown;

    if (Array.isArray(result)) {
      const status = String(result[0]);
      if (status === "INSUFFICIENT_CREDITS") {
        return { unlocked: false, reason: "INSUFFICIENT_CREDITS" };
      }
      const payloadRaw = result[1];
      if (typeof payloadRaw === "string") {
        try {
          const payload = JSON.parse(payloadRaw) as {
            charged_credits?: number;
            idempotency?: "NEW" | "REPLAY";
          };
          return {
            unlocked: true,
            chargedCredits: payload.charged_credits ?? 0,
            idempotency: payload.idempotency ?? "REPLAY",
          };
        } catch {
          return { unlocked: true, chargedCredits: 0, idempotency: "REPLAY" };
        }
      }
    }
    return { unlocked: false, reason: "INSUFFICIENT_CREDITS" };
  }

  // Gets spent credits for a wallet (defaults to 0).
  async getSpentCredits(walletAddress: string): Promise<number> {
    const key = `spent:${walletAddress}`;
    const value = await this.client.get(key);
    const parsed = Number(value ?? "0");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Stores unlock pending state for recovery.
  async setUnlockPending(unlockRequestId: string, payload: Record<string, unknown>): Promise<void> {
    const key = `unlock:pending:${unlockRequestId}`;
    await this.client.set(key, JSON.stringify(payload), { EX: 86400 });
  }

  // Fetches pending unlock state for recovery.
  async getUnlockPending(unlockRequestId: string): Promise<Record<string, unknown> | null> {
    const key = `unlock:pending:${unlockRequestId}`;
    const raw = await this.client.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Removes a pending unlock marker.
  async deleteUnlockPending(unlockRequestId: string): Promise<void> {
    const key = `unlock:pending:${unlockRequestId}`;
    await this.client.del(key);
  }

  // Fetches idempotency results for an unlock request.
  async getIdempotencyResult(unlockRequestId: string): Promise<Record<string, unknown> | null> {
    const key = `idem:${unlockRequestId}`;
    const raw = await this.client.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Stores idempotency result for unlock request.
  async setIdempotencyResult(unlockRequestId: string, payload: Record<string, unknown>): Promise<void> {
    const key = `idem:${unlockRequestId}`;
    await this.client.set(key, JSON.stringify(payload), { EX: 300 });
  }

  // Attempts to set an idempotency record if absent.
  async setIdempotencyIfAbsent(
    unlockRequestId: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    const key = `idem:${unlockRequestId}`;
    const result = await this.client.set(key, JSON.stringify(payload), { NX: true, EX: 300 });
    return result === "OK";
  }

  // Stores a top-up reference payload.
  async setTopupRef(reference: string, payload: Record<string, unknown>): Promise<void> {
    const key = `topup:ref:${reference}`;
    await this.client.set(key, JSON.stringify(payload));
  }

  // Fetches a top-up reference payload.
  async getTopupRef(reference: string): Promise<Record<string, unknown> | null> {
    const key = `topup:ref:${reference}`;
    const raw = await this.client.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Marks a top-up signature as processed (idempotency guard).
  async markTopupSignature(signature: string): Promise<boolean> {
    const key = `topup:tx:${signature}`;
    const result = await this.client.set(key, "1", { NX: true });
    return result === "OK";
  }

  // Checks whether a top-up signature was already processed.
  async hasTopupSignature(signature: string): Promise<boolean> {
    const key = `topup:tx:${signature}`;
    const value = await this.client.get(key);
    return value === "1";
  }

  // Stores an auth nonce payload with TTL.
  async setAuthNonce(nonce: string, payload: Record<string, unknown>, ttlSeconds: number): Promise<void> {
    const key = `auth:nonce:${nonce}`;
    await this.client.set(key, JSON.stringify(payload), { EX: ttlSeconds });
  }

  // Reads an auth nonce payload.
  async getAuthNonce(nonce: string): Promise<Record<string, unknown> | null> {
    const key = `auth:nonce:${nonce}`;
    const raw = await this.client.get(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Deletes an auth nonce key.
  async deleteAuthNonce(nonce: string): Promise<void> {
    const key = `auth:nonce:${nonce}`;
    await this.client.del(key);
  }

  // Stores an auth token bound to a wallet.
  async setAuthToken(token: string, walletAddress: string, ttlSeconds: number): Promise<void> {
    const key = `auth:token:${token}`;
    await this.client.set(key, walletAddress, { EX: ttlSeconds });
  }

  // Reads wallet address from an auth token.
  async getAuthTokenWallet(token: string): Promise<string | null> {
    const key = `auth:token:${token}`;
    const value = await this.client.get(key);
    return value ?? null;
  }
}
