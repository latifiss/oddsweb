import { Redis } from "@upstash/redis";

let client: Redis | undefined;

function getClient(): Redis {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("UPSTASH_REDIS_REST_URL must be a valid URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("UPSTASH_REDIS_REST_URL must use HTTPS.");
  }

  client = new Redis({ url: parsedUrl.toString(), token });
  return client;
}

/**
 * Lazily creates the Redis client so builds and public pages do not fail
 * merely because runtime secrets are not present in the build environment.
 * Operations fail explicitly when Redis is required but not configured.
 */
export const redis = new Proxy({} as Redis, {
  get(_target, property) {
    const instance = getClient();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
