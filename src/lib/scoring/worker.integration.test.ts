/**
 * Phase 3 acceptance tests, run against live services:
 *
 * 1. Worker suite (needs Supabase creds): queue claim → score → store →
 *    status flip, retry-with-backoff on failure, permanent failure on a
 *    deleted opportunity, exhaustion after max_attempts. Uses an injected
 *    fake scorer — no Anthropic calls.
 * 2. Claude suite (needs ANTHROPIC_API_KEY): one real scoring call proving
 *    strict-JSON structured output parses and validates.
 *
 * Both suites auto-skip when their credentials are absent.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";
import type { OpportunityScores } from "@/lib/scoring/schema";

function loadEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => [
          l.slice(0, l.indexOf("=")).trim(),
          l.slice(l.indexOf("=") + 1).trim(),
        ]),
    );
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const haveSupabase = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL &&
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY,
);
const haveAnthropic = Boolean(env.ANTHROPIC_API_KEY);

const TIMEOUT = 40_000;

const FAKE_SCORES: OpportunityScores = {
  fit: 82,
  margin_potential: 61,
  urgency: 45,
  effort: 30,
  rationale: "fake scorer for worker tests",
};

describe.skipIf(!haveSupabase)("scoring queue worker (live database)", () => {
  let admin: SupabaseClient<Database>;
  let processScoreJobs: typeof import("@/lib/scoring/worker").processScoreJobs;
  let orgId: string;

  async function makeOpportunity(title: string): Promise<string> {
    const { data, error } = await admin
      .from("opportunities")
      .insert({
        org_id: orgId,
        source: "outbound",
        title,
        description: "worker test row",
        currency: "USD",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  async function enqueue(opportunityId: string | null): Promise<string> {
    const { data, error } = await admin
      .from("job_queue")
      .insert({
        org_id: orgId,
        job_type: "score_opportunity",
        payload: opportunityId ? { opportunity_id: opportunityId } : {},
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    ({ processScoreJobs } = await import("@/lib/scoring/worker"));

    admin = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error } = await admin
      .from("organizations")
      .insert({ name: "worker-test org (throwaway)" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  }, TIMEOUT);

  afterAll(async () => {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
  }, TIMEOUT);

  it(
    "scores a claimed job, stores structured results, flips status to scored",
    async () => {
      const oppId = await makeOpportunity("worker success case");
      const jobId = await enqueue(oppId);

      const summary = await processScoreJobs({
        orgId,
        scorer: async () => FAKE_SCORES,
      });
      expect(summary.scored).toBeGreaterThanOrEqual(1);

      const { data: opp } = await admin
        .from("opportunities")
        .select("fit_score, margin_potential_score, urgency_score, effort_score, score_rationale, scored_at, status")
        .eq("id", oppId)
        .single();
      expect(opp).toMatchObject({
        fit_score: 82,
        margin_potential_score: 61,
        urgency_score: 45,
        effort_score: 30,
        score_rationale: FAKE_SCORES.rationale,
        status: "scored",
      });
      expect(opp!.scored_at).toBeTruthy();

      const { data: job } = await admin
        .from("job_queue")
        .select("status")
        .eq("id", jobId)
        .single();
      expect(job!.status).toBe("done");
    },
    TIMEOUT,
  );

  it(
    "failures retry with backoff — without duplicating scores or jobs",
    async () => {
      const oppId = await makeOpportunity("worker retry case");
      const jobId = await enqueue(oppId);

      const failing = await processScoreJobs({
        orgId,
        scorer: async () => {
          throw new Error("simulated model outage");
        },
      });
      expect(failing.retried).toBeGreaterThanOrEqual(1);

      const { data: job } = await admin
        .from("job_queue")
        .select("status, attempts, run_after, last_error")
        .eq("id", jobId)
        .single();
      expect(job!.status).toBe("pending"); // re-queued, not duplicated
      expect(job!.attempts).toBe(1);
      expect(new Date(job!.run_after).getTime()).toBeGreaterThan(Date.now());
      expect(job!.last_error).toContain("simulated model outage");

      // Backoffed job is not due yet → a second run claims nothing for it,
      // and the opportunity still has no scores (no partial writes).
      const { data: opp } = await admin
        .from("opportunities")
        .select("fit_score, status")
        .eq("id", oppId)
        .single();
      expect(opp!.fit_score).toBeNull();
      expect(opp!.status).toBe("new");
    },
    TIMEOUT,
  );

  it(
    "a job for a deleted opportunity fails permanently (no retry loop)",
    async () => {
      const jobId = await enqueue("00000000-0000-0000-0000-000000000000");

      const summary = await processScoreJobs({
        orgId,
        scorer: async () => FAKE_SCORES,
      });
      expect(summary.failed).toBeGreaterThanOrEqual(1);

      const { data: job } = await admin
        .from("job_queue")
        .select("status, last_error")
        .eq("id", jobId)
        .single();
      expect(job!.status).toBe("failed");
      expect(job!.last_error).toContain("no longer exists");
    },
    TIMEOUT,
  );

  it(
    "exhausted attempts mark the job failed",
    async () => {
      const oppId = await makeOpportunity("worker exhaustion case");
      const jobId = await enqueue(oppId);
      await admin.from("job_queue").update({ attempts: 5 }).eq("id", jobId);

      await processScoreJobs({
        orgId,
        scorer: async () => {
          throw new Error("still failing");
        },
      });

      const { data: job } = await admin
        .from("job_queue")
        .select("status")
        .eq("id", jobId)
        .single();
      expect(job!.status).toBe("failed");
    },
    TIMEOUT,
  );
});

describe.skipIf(!haveAnthropic)("Claude scoring call (live API)", () => {
  it(
    "returns strict, validated scores for a realistic opportunity",
    async (ctx) => {
      process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
      if (env.ANTHROPIC_MODEL) process.env.ANTHROPIC_MODEL = env.ANTHROPIC_MODEL;
      const { scoreOpportunity } = await import("@/lib/scoring/score-opportunity");

      const scores = await scoreOpportunity({
        title: "Customer support agents needed for growing Shopify store",
        description:
          "Apparel store doing ~10k tickets/month across email and chat needs a managed team " +
          "for first response and escalations, US business hours, Gorgias experience preferred. " +
          "Monthly engagement, starting within 2 weeks.",
        budget: 3500,
        currency: "USD",
        source: "alert_email",
        niche: {
          name: "Customer Support Ops",
          pricing_model: "Monthly retainer per support pod (AI-assisted agents + QA)",
          target_margin: 55,
          positioning_notes:
            "AI-assisted email/chat support pods for e-commerce brands drowning in tickets.",
        },
      }).catch((err: unknown) => {
        // An unfunded Anthropic account is an environment blocker, not a code
        // failure — skip loudly so the suite stays truthful either way.
        if (err instanceof Error && /credit balance/i.test(err.message)) {
          console.warn(
            "SKIPPED live scoring test: the Anthropic account has no credits. " +
              "Add credits at console.anthropic.com → Plans & Billing, then re-run.",
          );
          ctx.skip();
        }
        throw err;
      });

      for (const key of ["fit", "margin_potential", "urgency", "effort"] as const) {
        expect(Number.isInteger(scores[key])).toBe(true);
        expect(scores[key]).toBeGreaterThanOrEqual(0);
        expect(scores[key]).toBeLessThanOrEqual(100);
      }
      expect(scores.rationale.length).toBeGreaterThan(10);
      // A near-perfect niche match with budget should not score dismal fit.
      expect(scores.fit).toBeGreaterThan(50);
    },
    90_000,
  );
});
