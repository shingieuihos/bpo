import { NextResponse, type NextRequest } from "next/server";

import { createOpportunity } from "@/lib/ingestion/create-opportunity";
import { parseCsv } from "@/lib/ingestion/csv";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BODY = 2 * 1024 * 1024; // 2 MB of prospects is plenty per import
const MAX_ROWS = 2000;

interface ProspectRow {
  title?: string;
  company?: string;
  description?: string;
  notes?: string;
  budget?: number | string;
  currency?: string;
  url?: string;
  niche?: string;
  ref?: string;
}

/**
 * Outbound prospect import (source = outbound): CSV or JSON array of enriched
 * prospects, uploaded by the signed-in operator.
 *
 * Auth: Supabase session (org membership enforced — the operator can only
 * import into an org they belong to). Content-Type selects the format:
 * text/csv (header row: company,title,description,budget,currency,url,niche,ref)
 * or application/json ([{ company, title, ... }]).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();
  if (authError || !claimsData?.claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Org: the caller's membership (single-org operator default; ?org=<uuid>
  // must match one of their memberships otherwise).
  const { data: memberships, error: memberError } = await supabase
    .from("org_members")
    .select("org_id");
  if (memberError || !memberships || memberships.length === 0) {
    return NextResponse.json({ error: "no org membership" }, { status: 403 });
  }
  const requestedOrg = request.nextUrl.searchParams.get("org");
  const orgId = requestedOrg ?? memberships[0].org_id;
  if (!memberships.some((m) => m.org_id === orgId)) {
    return NextResponse.json({ error: "not a member of that org" }, { status: 403 });
  }

  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let rows: ProspectRow[];
  if (contentType.includes("text/csv")) {
    rows = parseCsv(bodyText) as ProspectRow[];
  } else {
    try {
      const parsed = JSON.parse(bodyText);
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { error: "JSON body must be an array of prospects" },
          { status: 400 },
        );
      }
      rows = parsed as ProspectRow[];
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "no rows to import" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `too many rows (max ${MAX_ROWS} per import)` },
      { status: 400 },
    );
  }

  let created = 0;
  let duplicates = 0;
  const invalid: number[] = [];

  for (const [index, row] of rows.entries()) {
    const company = row.company?.toString().trim();
    const title =
      row.title?.toString().trim() ||
      (company ? `Prospect: ${company}` : undefined);
    if (!title) {
      invalid.push(index);
      continue;
    }

    const budget =
      typeof row.budget === "string" ? Number.parseFloat(row.budget) : row.budget;

    const outcome = await createOpportunity(orgId, {
      source: "outbound",
      sourceRef: row.ref?.toString().trim() || null,
      title,
      description:
        row.description?.toString().trim() ||
        row.notes?.toString().trim() ||
        null,
      budget: Number.isFinite(budget) ? (budget as number) : null,
      currency: row.currency?.toString(),
      url: row.url?.toString().trim() || null,
      nicheHint: row.niche?.toString(),
      raw: row,
    });

    if (outcome.status === "created") created += 1;
    else if (outcome.status === "duplicate") duplicates += 1;
    else invalid.push(index);
  }

  return NextResponse.json({
    imported: created,
    duplicates,
    invalid_rows: invalid,
    total: rows.length,
  });
}
