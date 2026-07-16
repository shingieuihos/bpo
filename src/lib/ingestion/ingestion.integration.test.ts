/**
 * Live ingestion test — Phase 2 acceptance: "each source can create an
 * opportunity; dedup works". Runs against the linked Supabase project with
 * credentials from .env.local; skipped entirely when they're absent.
 *
 * Uses a dedicated throwaway org (no auth user needed — the pipeline itself
 * is service-role) and deletes it afterwards, cascading all test rows.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";
import type { createOpportunity as CreateOpportunityFn } from "@/lib/ingestion/create-opportunity";

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
const haveCreds = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL &&
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY,
);

const TIMEOUT = 30_000;

describe.skipIf(!haveCreds)("ingestion pipeline (live database)", () => {
  let admin: SupabaseClient<Database>;
  let createOpportunity: typeof CreateOpportunityFn;
  let orgId: string;

  beforeAll(async () => {
    // create-opportunity reads these through the app's env helpers.
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    ({ createOpportunity } = await import("@/lib/ingestion/create-opportunity"));

    admin = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error } = await admin
      .from("organizations")
      .insert({ name: "ingestion-test org (throwaway)" })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
  }, TIMEOUT);

  afterAll(async () => {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
  }, TIMEOUT);

  it(
    "every source type can create an opportunity",
    async () => {
      const sources = [
        "marketplace_api",
        "alert_email",
        "owned_inbound",
        "outbound",
      ] as const;

      for (const source of sources) {
        const outcome = await createOpportunity(orgId, {
          source,
          sourceRef: `itest:${source}:1`,
          title: `Integration test opportunity via ${source}`,
          description: "test row — cleaned up automatically",
          budget: 100,
          raw: { itest: true },
        });
        expect(outcome.status, `source ${source}`).toBe("created");
      }

      const { count } = await admin
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);
      expect(count).toBe(sources.length);
    },
    TIMEOUT,
  );

  it(
    "hard dedup: the same source_ref is ingested exactly once",
    async () => {
      const outcome = await createOpportunity(orgId, {
        source: "alert_email",
        sourceRef: "itest:alert_email:1", // same ref as above
        title: "Same job arriving again from a second alert email",
        raw: {},
      });
      expect(outcome.status).toBe("duplicate");
    },
    TIMEOUT,
  );

  it(
    "soft dedup: identical content without a ref is ingested exactly once",
    async () => {
      const lead = {
        source: "owned_inbound" as const,
        sourceRef: null,
        title: "Inbound: Acme — needs a support pod",
        budget: 900,
        raw: {},
      };
      const first = await createOpportunity(orgId, lead);
      expect(first.status).toBe("created");
      const second = await createOpportunity(orgId, {
        ...lead,
        title: "  inbound: ACME — needs a support pod ", // normalization noise
      });
      expect(second.status).toBe("duplicate");
    },
    TIMEOUT,
  );

  it(
    "every created opportunity enqueued exactly one scoring job",
    async () => {
      const { count: oppCount } = await admin
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);
      const { data: jobs } = await admin
        .from("job_queue")
        .select("job_type, status, payload")
        .eq("org_id", orgId);

      expect(jobs).toHaveLength(oppCount ?? -1);
      for (const job of jobs!) {
        expect(job.job_type).toBe("score_opportunity");
        expect(job.status).toBe("pending");
        expect((job.payload as { opportunity_id?: string }).opportunity_id).toBeTruthy();
      }
    },
    TIMEOUT,
  );

  it(
    "rejects a titleless payload as invalid",
    async () => {
      const outcome = await createOpportunity(orgId, {
        source: "outbound",
        title: "   ",
        raw: {},
      });
      expect(outcome.status).toBe("invalid");
    },
    TIMEOUT,
  );
});

describe.skipIf(haveCreds)("ingestion pipeline (skipped)", () => {
  it("skipped: no Supabase credentials in .env.local", () => {
    expect(haveCreds).toBe(false);
  });
});
