import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { apiClient } from "@/lib/api/apiFootballClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Fixture {
  fixture: { id: number; status: { short: string } };
  league: { id: number };
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

async function claimRun(): Promise<boolean> {
  // An expiring NX key prevents concurrent invocations from both doing the work.
  const result = await redis.set("last_prefetch_run", Date.now(), { nx: true, ex: 6 * 60 * 60 });
  return result === "OK";
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron authentication is not configured." }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.API_FOOTBALL_KEY) {
    return NextResponse.json({ error: "API_FOOTBALL_KEY is not configured." }, { status: 503 });
  }

  try {
    if (!(await claimRun())) {
      return NextResponse.json({ success: true, skipped: true, reason: "A recent run already claimed this window." });
    }

    const today = new Date().toISOString().slice(0, 10);
    const data = await apiClient.getCached<Fixture[]>("fixtures", { date: today }, { ttl: 300 });
    const popularLeagueIds = new Set([39, 140, 78, 135, 61, 2, 3]);
    const matches = (data.response ?? [])
      .filter((match) => popularLeagueIds.has(match.league.id) && match.fixture.status.short === "NS")
      .slice(0, 10);

    const results = await Promise.allSettled(matches.map(async (match) => {
      await apiClient.getCached("predictions", { fixture: match.fixture.id }, { ttl: 7_200 });
      await apiClient.getCached("odds", { fixture: match.fixture.id }, { ttl: 1_800 });
      return match.fixture.id;
    }));

    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    return NextResponse.json({
      success: true,
      preFetched: succeeded,
      failed: results.length - succeeded,
      total: matches.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Prefetch failed.", error);
    return NextResponse.json({ error: "Prefetch failed." }, { status: 500 });
  }
}
