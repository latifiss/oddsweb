import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { apiClient } from "@/lib/api/apiFootballClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, error: "Cron authentication is not configured." },
      { status: 503 },
    );
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.API_FOOTBALL_KEY) {
    return NextResponse.json(
      { success: false, error: "API_FOOTBALL_KEY is not configured." },
      { status: 503 },
    );
  }

  const startedAt = Date.now();

  try {
    const today = new Date().toISOString().slice(0, 10);
    const fixturesData = await apiClient.getCached<any[]>(
      "fixtures",
      { date: today, timezone: "GMT" },
      { ttl: 3_600 },
    );
    const fixtures = fixturesData.response ?? [];

    if (fixtures.length === 0) {
      const timestamp = new Date().toISOString();
      await Promise.all([
        redis.set("predictions_feed", JSON.stringify([]), { ex: 86_400 }),
        redis.set("predictions_last_update", timestamp, { ex: 86_400 }),
        redis.set("predictions_fixture_count", 0, { ex: 86_400 }),
        redis.set("predictions_total_available", 0, { ex: 86_400 }),
        redis.set("predictions_selected_ids", JSON.stringify([]), { ex: 86_400 }),
        redis.set("predictions_success_count", 0, { ex: 86_400 }),
        redis.set("predictions_error_count", 0, { ex: 86_400 }),
      ]);

      return NextResponse.json({
        success: true,
        message: "No fixtures found for today.",
        timestamp,
        fixturesProcessed: 0,
        totalFixturesAvailable: 0,
        durationMs: Date.now() - startedAt,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const selectedFixtures = fixtures.slice(0, 10);
    const predictionsData: Array<Record<string, unknown>> = [];
    let errorCount = 0;

    for (const fixture of selectedFixtures) {
      try {
        const fixtureId = fixture.fixture?.id;
        if (!Number.isInteger(fixtureId)) {
          errorCount += 1;
          continue;
        }

        const predictionData = await apiClient.getCached<any[]>(
          "predictions",
          { fixture: fixtureId },
          { ttl: 7_200 },
        );
        const predictions = predictionData.response ?? [];

        predictionsData.push({
          fixtureId,
          fixture: {
            id: fixtureId,
            homeTeam: fixture.teams?.home?.name ?? "Unknown",
            awayTeam: fixture.teams?.away?.name ?? "Unknown",
            homeLogo: fixture.teams?.home?.logo ?? null,
            awayLogo: fixture.teams?.away?.logo ?? null,
            date: fixture.fixture?.date ?? null,
            venue: fixture.fixture?.venue?.name ?? "Unknown",
            status: fixture.fixture?.status?.short ?? "NS",
            elapsed: fixture.fixture?.status?.elapsed ?? null,
          },
          league: {
            id: fixture.league?.id ?? null,
            name: fixture.league?.name ?? "Unknown",
            country: fixture.league?.country ?? null,
            logo: fixture.league?.logo ?? null,
            season: fixture.league?.season ?? null,
          },
          predictions,
          hasPredictions: predictions.length > 0,
          lastUpdated: new Date().toISOString(),
        });
      } catch (error) {
        errorCount += 1;
        console.error("Prediction fetch failed for a fixture.", error);
      }
    }

    // Do not replace a previously good feed with an empty result after provider failures.
    if (predictionsData.length === 0 && selectedFixtures.length > 0) {
      return NextResponse.json({
        success: false,
        error: "No fixture predictions could be fetched; the previous feed was preserved.",
        fixturesProcessed: 0,
        totalFixturesAvailable: fixtures.length,
        errorCount,
        durationMs: Date.now() - startedAt,
      }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    const timestamp = new Date().toISOString();
    const selectedIds = selectedFixtures.map((fixture: any) => fixture.fixture.id);

    await Promise.all([
      redis.set("predictions_feed", JSON.stringify(predictionsData), { ex: 86_400 }),
      redis.set("predictions_last_update", timestamp, { ex: 86_400 }),
      redis.set("predictions_fixture_count", predictionsData.length, { ex: 86_400 }),
      redis.set("predictions_total_available", fixtures.length, { ex: 86_400 }),
      redis.set("predictions_selected_ids", JSON.stringify(selectedIds), { ex: 86_400 }),
      redis.set("predictions_success_count", predictionsData.length, { ex: 86_400 }),
      redis.set("predictions_error_count", errorCount, { ex: 86_400 }),
    ]);

    return NextResponse.json({
      success: true,
      message: `Updated predictions for ${predictionsData.length} fixtures.`,
      timestamp,
      fixturesProcessed: predictionsData.length,
      totalFixturesAvailable: fixtures.length,
      successCount: predictionsData.length,
      errorCount,
      durationMs: Date.now() - startedAt,
      selectedFixtureIds: selectedIds,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prediction update failed.", error);
    return NextResponse.json({
      success: false,
      error: "Prediction update failed.",
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
