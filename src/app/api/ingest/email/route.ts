import { NextResponse, type NextRequest } from "next/server";

import {
  createOpportunity,
  resolveIngestOrg,
} from "@/lib/ingestion/create-opportunity";
import { parseAlertEmail } from "@/lib/ingestion/parse-alert-email";
import { secureCompare } from "@/lib/ingestion/secure-compare";

export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024; // generous for a text email, hostile to abuse

/**
 * Alert-email intake (source = alert_email).
 *
 * Receives job-alert emails the operator configured inside a marketplace,
 * forwarded here by their email pipeline (e.g. Cloudflare Email Workers,
 * Mailgun/SendGrid inbound parse — anything that can POST JSON).
 *
 * Auth: X-Ingest-Secret header must match INGEST_EMAIL_SECRET (constant-time).
 * Body: { subject?: string, text: string }  — the plaintext email body.
 * Optional ?org=<uuid> when more than one org exists.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INGEST_EMAIL_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "alert-email ingestion is not configured (INGEST_EMAIL_SECRET unset)" },
      { status: 503 },
    );
  }
  if (!secureCompare(request.headers.get("x-ingest-secret"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let payload: { subject?: string; text?: string };
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!payload.text?.trim()) {
    return NextResponse.json(
      { error: "body must include `text` (plaintext email body)" },
      { status: 400 },
    );
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

  const jobs = parseAlertEmail(payload.text);
  let created = 0;
  let duplicates = 0;

  for (const job of jobs) {
    const outcome = await createOpportunity(orgId, {
      source: "alert_email",
      sourceRef: job.url,
      title: job.title,
      description: job.description,
      budget: job.budget,
      currency: job.currency,
      url: job.url,
      // Store the parsed job + subject, NOT the whole inbox payload.
      raw: { subject: payload.subject ?? null, parsed: job },
    });
    if (outcome.status === "created") created += 1;
    if (outcome.status === "duplicate") duplicates += 1;
  }

  return NextResponse.json({ parsed: jobs.length, created, duplicates });
}
