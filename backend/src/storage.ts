import { createClient } from "redis";

// JSON payload for job state storage.
export type JobRecord = Record<string, unknown>;

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
}
