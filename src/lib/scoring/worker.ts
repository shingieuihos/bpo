import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  scoreOpportunity,
  type Scorer,
} from "@/lib/scoring/score-opportunity";

/** Exponential backoff for retries: 1m, 2m, 4m, 8m... capped at 30m. */
function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
}

export interface WorkerSummary {
  claimed: number;
  scored: number;
  retried: number;
  failed: number;
}

/**
 * Claim and process pending 'score_opportunity' jobs.
 *
 * Retry-safe by design:
 * - claim_queue_jobs flips jobs to 'processing' atomically (SKIP LOCKED), so
 *   concurrent workers never double-claim;
 * - a scoring failure re-queues with exponential backoff until max_attempts,
 *   then the job is marked 'failed' with the error recorded;
 * - re-scoring an opportunity overwrites the same row — retries can never
 *   duplicate data (the opportunity row is keyed, not appended).
 *
 * `scorer` is injectable for tests; production uses the Claude scorer.
 */
export async function processScoreJobs(options?: {
  limit?: number;
  orgId?: string;
  scorer?: Scorer;
}): Promise<WorkerSummary> {
  const limit = options?.limit ?? 10;
  const scorer = options?.scorer ?? scoreOpportunity;
  const admin = createAdminClient();

  const { data: jobs, error: claimError } = await admin.rpc("claim_queue_jobs", {
    p_job_type: "score_opportunity",
    p_limit: limit,
  });
  if (claimError) throw new Error(`queue claim failed: ${claimError.message}`);

  const summary: WorkerSummary = { claimed: 0, scored: 0, retried: 0, failed: 0 };

  for (const job of jobs ?? []) {
    // Optional org scoping (used by the in-app "Run scoring" action).
    if (options?.orgId && job.org_id !== options.orgId) {
      await admin
        .from("job_queue")
        .update({ status: "pending", attempts: Math.max(0, job.attempts - 1) })
        .eq("id", job.id);
      continue;
    }
    summary.claimed += 1;

    const opportunityId = (job.payload as { opportunity_id?: string })
      ?.opportunity_id;

    try {
      if (!opportunityId) throw new PermanentJobError("job payload has no opportunity_id");

      const { data: opp, error: oppError } = await admin
        .from("opportunities")
        .select(
          "id, org_id, title, description, budget, currency, source, status, niches (name, pricing_model, target_margin, positioning_notes)",
        )
        .eq("id", opportunityId)
        .maybeSingle();
      if (oppError) throw new Error(`opportunity load failed: ${oppError.message}`);
      if (!opp) throw new PermanentJobError("opportunity no longer exists");

      const scores = await scorer({
        title: opp.title,
        description: opp.description,
        budget: opp.budget,
        currency: opp.currency,
        source: opp.source,
        niche: opp.niches,
      });

      const { error: updateError } = await admin
        .from("opportunities")
        .update({
          fit_score: scores.fit,
          margin_potential_score: scores.margin_potential,
          urgency_score: scores.urgency,
          effort_score: scores.effort,
          score_rationale: scores.rationale,
          scored_at: new Date().toISOString(),
          // Only advance brand-new opportunities; never regress a later status.
          ...(opp.status === "new" ? { status: "scored" as const } : {}),
        })
        .eq("id", opp.id);
      if (updateError) throw new Error(`score write failed: ${updateError.message}`);

      await admin
        .from("job_queue")
        .update({ status: "done", last_error: null })
        .eq("id", job.id);
      summary.scored += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentJobError;
      const exhausted = job.attempts >= job.max_attempts;

      if (permanent || exhausted) {
        await admin
          .from("job_queue")
          .update({ status: "failed", last_error: message.slice(0, 2000) })
          .eq("id", job.id);
        summary.failed += 1;
      } else {
        await admin
          .from("job_queue")
          .update({
            status: "pending",
            run_after: new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
            last_error: message.slice(0, 2000),
          })
          .eq("id", job.id);
        summary.retried += 1;
      }
    }
  }

  return summary;
}

/** Errors that must NOT be retried (missing payload, deleted opportunity). */
export class PermanentJobError extends Error {}
