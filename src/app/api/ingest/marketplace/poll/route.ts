import { NextResponse, type NextRequest } from "next/server";

import {
  createOpportunity,
  resolveIngestOrg,
} from "@/lib/ingestion/create-opportunity";
import { getMarketplaceAdapter } from "@/lib/ingestion/marketplace/adapter";
import { secureCompare } from "@/lib/ingestion/secure-compare";

export const dynamic = "force-dynamic";

/**
 * Marketplace read-API poll (source = marketplace_api).
 *
 * Invoked by a scheduler (Vercel cron / Supabase scheduled function) with
 * Authorization: Bearer <CRON_SECRET>. Fully inert unless the operator has
 * BOTH enabled the feature flag and installed official API credentials —
 * see the compliance contract in src/lib/ingestion/marketplace/adapter.ts.
 * There is no scraping fallback, by design and by policy.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "poll endpoint is not configured (CRON_SECRET unset)" },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!secureCompare(auth, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adapter = getMarketplaceAdapter();
  if (!adapter.isConfigured()) {
    return NextResponse.json({
      enabled: false,
      note: "marketplace adapter is inert: feature flag off or no official API credentials",
    });
  }

  let orgId: string;
  try {
    orgId = await resolveIngestOrg(request.nextUrl.searchParams.get("org"));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "org resolution failed" },
      { status: 400 },
    );
  }

  const jobs = await adapter.fetchJobs({ limit: 50 });
  let created = 0;
  let duplicates = 0;

  for (const job of jobs) {
    const outcome = await createOpportunity(orgId, {
      source: "marketplace_api",
      sourceRef: job.url,
      title: job.title,
      description: job.description,
      budget: job.budget,
      currency: job.currency,
      url: job.url,
      raw: { adapter: adapter.id, job },
    });
    if (outcome.status === "created") created += 1;
    if (outcome.status === "duplicate") duplicates += 1;
  }

  return NextResponse.json({ enabled: true, fetched: jobs.length, created, duplicates });
}
