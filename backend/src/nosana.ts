import { Client } from "@nosana/sdk";
import { Config, normalizeApiBase, normalizeSdkBase } from "./config.js";

// Simple async sleep helper.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Creates a Nosana SDK client with API key auth.
export const createNosanaClient = (config: Config) => {
  const backendUrl = normalizeSdkBase(config.nosanaApiBase);
  return new Client("mainnet", undefined, {
    apiKey: config.nosanaApiKey,
    api: { backend_url: backendUrl },
  });
};

// Creates a deployment with the given job definition.
export const createDeployment = async (
  nosana: ReturnType<typeof createNosanaClient>,
  config: Config,
  jobId: string,
  payload: Record<string, string>
) => {
  return await nosana.deployments.create({
    name: jobId,
    market: config.nosanaMarket,
    timeout: 60,
    replicas: 1,
    strategy: "SIMPLE",
    confidential: false,
    job_definition: {
      version: "0.1",
      type: "container",
      meta: { trigger: "api" },
      ops: [
        {
          id: "worker",
          type: "container/run",
          args: {
            image: config.nosanaWorkerImage,
            gpu: true,
          },
        },
      ],
      global: {
        image: config.nosanaWorkerImage,
        gpu: true,
        env: payload,
      },
    },
  });
};

// Starts a deployment after waiting for a valid state.
export const startDeployment = async (
  nosana: ReturnType<typeof createNosanaClient>,
  deploymentId: string
): Promise<string | null> => {
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const deployment = await nosana.deployments.get(deploymentId);
      if (deployment.status === "STARTING" || deployment.status === "RUNNING") {
        return null;
      }
      if (deployment.status !== "DRAFT") {
        break;
      }
      await sleep(2000);
    }
    const deployment = await nosana.deployments.get(deploymentId);
    await deployment.start();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

// Checks whether the worker image is listed in market required images.
export const fetchMarketCache = async (config: Config) => {
  const apiBase = normalizeApiBase(config.nosanaApiBase);
  const response = await fetch(
    `${apiBase}/markets/${config.nosanaMarket}/required-resources`,
    {
      headers: {
        Authorization: `Bearer ${config.nosanaApiKey}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Nosana market cache check failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    required_images?: string[];
  };
  const required = data.required_images ?? [];
  return {
    cached: required.includes(config.nosanaWorkerImage),
    resources: required,
  };
};
