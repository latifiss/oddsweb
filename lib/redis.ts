import { redis } from "@/lib/cache/redisClient";

export { redis };

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error("Rate limit and window must be positive integers.");
  }

  try {
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, windowSeconds);
    }
    return current <= limit;
  } catch (error) {
    // Fail closed: an unavailable limiter must not silently disable protection.
    console.error("Rate limit check failed:", error);
    return false;
  }
}
