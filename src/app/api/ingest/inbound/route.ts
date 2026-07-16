import { NextResponse, type NextRequest } from "next/server";

import {
  createOpportunity,
  resolveIngestOrg,
} from "@/lib/ingestion/create-opportunity";
import { secureCompare } from "@/lib/ingestion/secure-compare";

export const dynamic = "force-dynamic";

const MAX_BODY = 32 * 1024;

/**
 * Owned-inbound intake (source = owned_inbound): the endpoint the operator's
 * OWN landing pages / funnels post leads to.
 *
 * Auth: X-Ingest-Token must match INGEST_FORM_TOKEN — a form key that gates
 * drive-by spam; rotate it freely, it grants nothing but lead submission.
 * Honeypot: a filled `website` field silently accepts-and-drops bot posts.
 *
 * Body: { name, email?, company?, need, budget?, source_page? }
 */
export async function POST(request: NextRequest) {
  const token = process.env.INGEST_FORM_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "inbound ingestion is not configured (INGEST_FORM_TOKEN unset)" },
      { status: 503 },
    );
  }
  if (!secureCompare(request.headers.get("x-ingest-token"), token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let lead: {
    name?: string;
    email?: string;
    company?: string;
    need?: string;
    budget?: number | string;
    source_page?: string;
    website?: string; // honeypot — humans never see or fill this field
  };
  try {
    lead = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Honeypot tripped: pretend success, store nothing.
  if (lead.website) return NextResponse.json({ ok: true });

  const name = lead.name?.trim();
  const need = lead.need?.trim();
  if (!name || !need) {
    return NextResponse.json(
      { error: "`name` and `need` are required" },
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

  const budget =
    typeof lead.budget === "string" ? Number.parseFloat(lead.budget) : lead.budget;

  const outcome = await createOpportunity(orgId, {
    source: "owned_inbound",
    // One inquiry per contact+ask; repeat identical submissions dedup away.
    sourceRef: null,
    title: `Inbound: ${lead.company?.trim() || name} — ${need.slice(0, 120)}`,
    description: need,
    budget: Number.isFinite(budget) ? (budget as number) : null,
    url: lead.source_page?.trim() || null,
    raw: {
      name,
      email: lead.email?.trim() || null,
      company: lead.company?.trim() || null,
      source_page: lead.source_page?.trim() || null,
    },
  });

  if (outcome.status === "invalid") {
    return NextResponse.json({ error: outcome.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, result: outcome.status });
}
