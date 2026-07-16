import type { Database } from "@/lib/database.types";

export type OpportunitySource = Database["public"]["Enums"]["opportunity_source"];

/**
 * The single normalized shape every ingestion source reduces to before
 * insertion. Whatever the channel (marketplace read API, alert email, owned
 * form, CSV import), it becomes one of these and flows through
 * createOpportunity() — normalization, dedup, insert, and scoring enqueue
 * live in exactly one place.
 */
export interface NormalizedOpportunity {
  source: OpportunitySource;
  /** Stable external identifier when the source provides one (job id, URL). */
  sourceRef?: string | null;
  title: string;
  description?: string | null;
  budget?: number | null;
  /** ISO-4217; defaults to USD. */
  currency?: string | null;
  url?: string | null;
  /** Original payload, stored verbatim in raw_payload for audit/debugging. */
  raw: unknown;
  /** Optional niche name hint — matched case-insensitively against niches.name. */
  nicheHint?: string | null;
}

export type IngestOutcome =
  | { status: "created"; opportunityId: string }
  | { status: "duplicate" }
  | { status: "invalid"; reason: string };
