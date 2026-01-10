import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Config } from "./config.js";

// Builds an S3 client for Cloudflare R2.
const createClient = (config: Config) => {
  return new S3Client({
    region: "auto",
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
};

// Converts a stream body to a UTF-8 string.
const streamToString = async (body: any): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
};

// Loads and parses the manifest JSON from R2.
export const loadManifest = async (config: Config, prefix: string) => {
  const client = createClient(config);
  const key = `${prefix.replace(/\/+$/, "")}/manifest.json`;
  const command = new GetObjectCommand({
    Bucket: config.r2Bucket,
    Key: key,
  });
  try {
    const response = await client.send(command);
    if (!response.Body) {
      throw new Error("Missing body");
    }
    const body = await streamToString(response.Body);
    return JSON.parse(body) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to load manifest ${key}: ${String(err)}`);
  }
};

// Creates presigned URLs for clip files.
export const signClipUrls = async (
  config: Config,
  prefix: string,
  clipFiles: string[]
) => {
  const client = createClient(config);
  const urls: string[] = [];
  for (const clipFile of clipFiles) {
    const key = `${prefix.replace(/\/+$/, "")}/${clipFile}`;
    try {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.r2Bucket,
          Key: key,
        }),
        { expiresIn: 3600 }
      );
      urls.push(url);
    } catch (err) {
      throw new Error(`Failed to sign URL for ${key}: ${String(err)}`);
    }
  }
  return urls;
};
