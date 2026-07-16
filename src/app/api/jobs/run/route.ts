import { NextResponse, type NextRequest } from "next/server";

import { secureCompare } from "@/lib/ingestion/secure-compare";
import { processScoreJobs } from "@/lib/scoring/worker";

export const dynamic = "force-dynamic";
// Scoring several opportunities can take a while; give the worker room.
export const maxDuration = 300;

/**
 * Queue worker endpoint. Invoked on a schedule (Vercel cron sends GET with
 * Authorization: Bearer $CRON_SECRET automatically) or manually via POST
 * with the same bearer token.
 */
async function run(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "worker is not configured (CRON_SECRET unset)" },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!secureCompare(auth, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await processScoreJobs({ limit: 10 });
    return NextResponse.json(summary);
  } catch (err) {
    // No payload contents in logs — just the failure class.
    console.error(
      `job worker run failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return NextResponse.json({ error: "worker run failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
