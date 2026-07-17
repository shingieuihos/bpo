import "server-only";

import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDedupKey } from "@/lib/ingestion/dedup";
import type {
  IngestOutcome,
  NormalizedOpportunity,
} from "@/lib/ingestion/types";

/** Postgres unique_violation — how a duplicate surfaces from the DB. */
const UNIQUE_VIOLATION = "23505";

const MAX_TITLE = 500;
const MAX_TEXT = 20_000;

/** Cap stored payload size; raw_payload is for audit, not archival. */
function capRawPayload(raw: unknown): Json {
  const json = JSON.stringify(raw ?? null);
  if (json === undefined) return null;
  if (json.length <= MAX_TEXT) return JSON.parse(json) as Json;
  return { truncated: true, preview: json.slice(0, MAX_TEXT) };
}

/**
 * The single write-path for ALL ingestion sources.
 *
 * Validates and normalizes the payload, computes a dedup key when the source
 * has no stable ref, inserts the opportunity, and enqueues an async
 * 'score_opportunity' job (consumed by the Phase 3 worker). Duplicates are
 * detected by the database's unique indexes — race-proof, not best-effort.
 *
 * Compliance note: this function only ever RECEIVES data that arrived through
 * approved channels (official read APIs, user-configured alert emails, the
 * operator's own forms, manual imports). Nothing here fetches external pages.
 */
export async function createOpportunity(
  orgId: string,
  input: NormalizedOpportunity,
): Promise<IngestOutcome> {
  const title = input.title?.trim();
  if (!title) return { status: "invalid", reason: "title is required" };
  if (!input.source) return { status: "invalid", reason: "source is required" };

  const budget =
    input.budget != null && Number.isFinite(input.budget) && input.budget >= 0
      ? Math.round(input.budget * 100) / 100
      : null;
  const currency = (input.currency ?? "USD").toUpperCase().slice(0, 3);
  const sourceRef = input.sourceRef?.trim() || null;

  const admin = createAdminClient();

  // Optional niche hint → niche_id (case-insensitive name match, org-scoped).
  let nicheId: string | null = null;
  if (input.nicheHint?.trim()) {
    const { data: niche } = await admin
      .from("niches")
      .select("id")
      .eq("org_id", orgId)
      .ilike("name", input.nicheHint.trim())
      .maybeSingle();
    nicheId = niche?.id ?? null;
  }

  const { data: created, error } = await admin
    .from("opportunities")
    .insert({
      org_id: orgId,
      source: input.source,
      source_ref: sourceRef,
      // Content-hash fallback only when there is no stable external ref.
      dedup_key: sourceRef
        ? null
        : computeDedupKey({
            source: input.source,
            title,
            url: input.url,
            budget,
          }),
      title: title.slice(0, MAX_TITLE),
      description: input.description?.trim().slice(0, MAX_TEXT) || null,
      budget,
      currency,
      url: input.url?.trim().slice(0, 2000) || null,
      niche_id: nicheId,
      raw_payload: capRawPayload(input.raw),
      status: "new",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" };
    throw new Error(`opportunity insert failed: ${error.message}`);
  }

  // Enqueue async scoring (Phase 3 worker consumes 'score_opportunity').
  // Non-fatal on failure: the opportunity exists; scoring can be re-enqueued.
  const { error: queueError } = await admin.from("job_queue").insert({
    org_id: orgId,
    job_type: "score_opportunity",
    payload: { opportunity_id: created.id },
  });
  if (queueError) {
    console.error(
      `job_queue enqueue failed for opportunity ${created.id}: ${queueError.code}`,
    );
  }

  return { status: "created", opportunityId: created.id };
}

/**
 * Resolve which org an unauthenticated-but-token-verified request (ingest
 * endpoints, MCP) belongs to. Precedence:
 *   1. explicit org id (?org=<uuid>),
 *   2. FORGEOS_ORG_ID env (multi-org installs pin the operator org),
 *   3. the OLDEST organization — in a single-operator install that is always
 *      the operator's workspace (created at signup; anything newer is
 *      transient, e.g. test fixtures).
 */
export async function resolveIngestOrg(
  explicitOrgId?: string | null,
): Promise<string> {
  const admin = createAdminClient();

  const pinned = explicitOrgId || process.env.FORGEOS_ORG_ID || null;
  if (pinned) {
    const { data, error } = await admin
      .from("organizations")
      .select("id")
      .eq("id", pinned)
      .maybeSingle();
    if (error || !data) throw new Error("unknown org");
    return data.id;
  }

  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`org lookup failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("no organization exists yet");
  return data[0].id;
}
