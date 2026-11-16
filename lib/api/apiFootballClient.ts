import { redis } from "@/lib/cache/redisClient";

interface CacheOptions {
  ttl?: number;
  forceRefresh?: boolean;
}

interface ApiFootballResponse<T = unknown> {
  response?: T;
  errors?: Record<string, unknown> | unknown[];
  [key: string]: unknown;
}

const API_BASE_URL = "https://v3.football.api-sports.io";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const MIN_REQUEST_INTERVAL_MS = 6_000;

class APIFootballClient {
  private static instance: APIFootballClient;
  private lastRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  private constructor() {}

  static getInstance(): APIFootballClient {
    if (!APIFootballClient.instance) {
      APIFootballClient.instance = new APIFootballClient();
    }
    return APIFootballClient.instance;
  }

  private async waitForRequestSlot(): Promise<void> {
    const run = this.requestQueue.then(async () => {
      const wait = Math.max(
        0,
        MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt),
      );
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.lastRequestAt = Date.now();
    });

    this.requestQueue = run.catch(() => undefined);
    await run;
  }

  async request<T = unknown>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<ApiFootballResponse<T>> {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      throw new Error("API_FOOTBALL_KEY is not configured.");
    }

    const normalizedEndpoint = endpoint.replace(/^\/+/, "");
    if (!/^[a-z0-9/_-]+$/i.test(normalizedEndpoint)) {
      throw new Error("Invalid API-Football endpoint.");
    }

    const url = new URL(normalizedEndpoint, API_BASE_URL + "/");
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await this.waitForRequestSlot();

      try {
        const response = await fetch(url, {
          headers: {
            "x-apisports-key": apiKey,
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": "v3.football.api-sports.io",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
        });

        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1_000, 10_000)
            : Math.min(1_000 * 2 ** attempt, 8_000);
          lastError = new Error(`API-Football temporarily unavailable (HTTP ${response.status}).`);
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          break;
        }

        if (!response.ok) {
          throw new Error(`API-Football request failed (HTTP ${response.status}).`);
        }

        const data = await response.json() as ApiFootballResponse<T>;
        const apiErrors = data.errors;
        const hasApiErrors = Array.isArray(apiErrors)
          ? apiErrors.length > 0
          : Boolean(apiErrors && Object.keys(apiErrors).length > 0);

        if (hasApiErrors) {
          throw new Error("API-Football returned an API-level error.");
        }

        return data;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS - 1 && !(error instanceof Error && error.message.startsWith("API-Football request failed"))) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(1_000 * 2 ** attempt, 8_000)));
          continue;
        }
        break;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("API-Football request failed.");
  }

  async getCached<T = unknown>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {},
    options: CacheOptions = {},
  ): Promise<ApiFootballResponse<T>> {
    const sortedParams = Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)),
    );
    const cacheKey = `api:${endpoint}:${JSON.stringify(sortedParams)}`;
    const ttl = Math.max(0, Math.floor(options.ttl ?? 300));

    if (!options.forceRefresh) {
      try {
        const cached = await redis.get<ApiFootballResponse<T> | string>(cacheKey);
        if (cached !== null && cached !== undefined) {
          if (typeof cached === "string") {
            try {
              return JSON.parse(cached) as ApiFootballResponse<T>;
            } catch {
              console.warn("Ignoring malformed API cache entry:", cacheKey);
            }
          } else {
            return cached;
          }
        }
      } catch (error) {
        console.warn("API cache read failed; falling back to API-Football.", error);
      }
    }

    const data = await this.request<T>(endpoint, params);

    if (ttl > 0) {
      try {
        await redis.set(cacheKey, JSON.stringify(data), { ex: ttl });
      } catch (error) {
        console.warn("API cache write failed.", error);
      }
    }

    return data;
  }
}

export const apiClient = APIFootballClient.getInstance();
