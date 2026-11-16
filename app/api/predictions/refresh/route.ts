import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron authentication is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await redis.del(
      "predictions_feed",
      "predictions_last_update",
      "predictions_fixture_count",
      "predictions_total_available",
      "predictions_selected_ids",
      "predictions_success_count",
      "predictions_error_count",
    );

    return NextResponse.json({
      success: true,
      message: "Prediction feed cache invalidated. Trigger the protected update endpoint to rebuild it.",
      invalidatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Prediction cache refresh failed.", error);
    return NextResponse.json({ error: "Failed to invalidate prediction cache." }, { status: 500 });
  }
}
