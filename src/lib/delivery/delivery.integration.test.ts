/**
 * Phase 6 acceptance, live database: a won deal spawns a delivery job with
 * tasks; the QA GATE blocks delivery until passed; task costs feed
 * deals.actual_delivery_cost and the DB-computed gross margin.
 * (AI decomposition/drafting are exercised separately — schema units +
 * billing-gated live test; here tasks are injected directly.)
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";
import { serializeTasks, type DeliveryTask } from "@/lib/delivery/tasks";

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
const TIMEOUT = 60_000;

function makeTask(over: Partial<DeliveryTask> & { id: string }): DeliveryTask {
  return {
    title: "task",
    description: "",
    assignee_type: "ai",
    assignee_ref: null,
    status: "todo",
    estimated_hours: 1,
    ai_draft: null,
    cost: null,
    ...over,
  };
}

describe.skipIf(!haveCreds)("delivery orchestration (live database)", () => {
  let admin: SupabaseClient<Database>;
  let delivery: typeof import("@/lib/delivery/delivery");
  let orgId: string;
  let userId: string;
  let dealId: string;

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    delivery = await import("@/lib/delivery/delivery");

    admin = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await admin.auth.admin.createUser({
      email: `delivery-${crypto.randomUUID()}@example.com`,
      password: `Del!${crypto.randomUUID()}`,
      email_confirm: true,
    });
    if (error) throw error;
    userId = user.user.id;
    const { data: membership } = await admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", userId)
      .single();
    orgId = membership!.org_id;

    const { data: deal } = await admin
      .from("deals")
      .insert({ org_id: orgId, stage: "won", value: 5000, currency: "USD" })
      .select("id")
      .single();
    dealId = deal!.id;
  }, TIMEOUT);

  afterAll(async () => {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, TIMEOUT);

  it(
    "won deal spawns a job; QA gate blocks; costs feed the deal's margin",
    async () => {
      // Non-won deals cannot spawn jobs.
      const { data: openDeal } = await admin
        .from("deals")
        .insert({ org_id: orgId, stage: "negotiation", currency: "USD" })
        .select("id")
        .single();
      await expect(
        delivery.createDeliveryJob({
          dealId: openDeal!.id,
          orgId,
          actorId: userId,
          brief: "x",
        }),
      ).rejects.toThrow(/won deals/);

      // 1. Spawn from the won deal (idempotent).
      const { jobId } = await delivery.createDeliveryJob({
        dealId,
        orgId,
        actorId: userId,
        brief: "Deliver 500 verified leads for Acme with weekly check-ins.",
      });
      const again = await delivery.createDeliveryJob({
        dealId,
        orgId,
        actorId: userId,
        brief: "different brief",
      });
      expect(again.jobId).toBe(jobId);

      // 2. Inject decomposed tasks (AI path unit/live-tested separately).
      const tasks = [
        makeTask({ id: "t1", title: "Build list", assignee_type: "ai" }),
        makeTask({ id: "t2", title: "Verify emails", assignee_type: "contractor" }),
      ];
      await admin
        .from("delivery_jobs")
        .update({ tasks: serializeTasks(tasks), status: "in_progress" })
        .eq("id", jobId);

      // 3. QA GATE: cannot deliver — not even in QA yet.
      await expect(
        delivery.markDelivered({ jobId, orgId, actorId: userId }),
      ).rejects.toThrow(/QA gate/);

      // 4. Cannot submit for QA with open tasks.
      await expect(
        delivery.submitForQA({ jobId, orgId, actorId: userId }),
      ).rejects.toThrow(/must be done/);

      // 5. Complete tasks with actual costs → deal cost rolls up live.
      await delivery.updateTask({
        jobId,
        orgId,
        taskId: "t1",
        patch: { status: "done", cost: 300 },
      });
      await delivery.updateTask({
        jobId,
        orgId,
        taskId: "t2",
        patch: { status: "done", cost: 950 },
      });

      const { data: dealAfterCosts } = await admin
        .from("deals")
        .select("actual_delivery_cost, gross_margin")
        .eq("id", dealId)
        .single();
      expect(Number(dealAfterCosts!.actual_delivery_cost)).toBe(1250);
      expect(Number(dealAfterCosts!.gross_margin)).toBe(3750); // 5000 − 1250

      // 6. QA: submit → still gated → rework path → pass → delivered.
      await delivery.submitForQA({ jobId, orgId, actorId: userId });
      await expect(
        delivery.markDelivered({ jobId, orgId, actorId: userId }),
      ).rejects.toThrow(/QA gate/); // pending QA verdict

      await delivery.recordQA({
        jobId,
        orgId,
        actorId: userId,
        verdict: "rework",
        notes: "verify bounce rate first",
      });
      const { data: reworkJob } = await admin
        .from("delivery_jobs")
        .select("status, qa_status, qa_notes")
        .eq("id", jobId)
        .single();
      expect(reworkJob).toMatchObject({ status: "in_progress", qa_status: "rework" });

      await delivery.submitForQA({ jobId, orgId, actorId: userId });
      await delivery.recordQA({ jobId, orgId, actorId: userId, verdict: "passed" });
      await delivery.markDelivered({ jobId, orgId, actorId: userId });

      const { data: done } = await admin
        .from("delivery_jobs")
        .select("status, qa_status")
        .eq("id", jobId)
        .single();
      expect(done).toMatchObject({ status: "delivered", qa_status: "passed" });

      // 7. Audit trail: created → qa_rework → qa_passed → delivered.
      const { data: audit } = await admin
        .from("audit_events")
        .select("action")
        .eq("entity_id", jobId);
      expect(audit!.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          "delivery_job.created",
          "delivery_job.qa_rework",
          "delivery_job.qa_passed",
          "delivery_job.delivered",
        ]),
      );
    },
    TIMEOUT,
  );
});

describe.skipIf(!env.ANTHROPIC_API_KEY)("AI decomposition (live API)", () => {
  it(
    "decomposes a brief into validated, routed tasks",
    async (ctx) => {
      process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
      if (env.ANTHROPIC_MODEL) process.env.ANTHROPIC_MODEL = env.ANTHROPIC_MODEL;
      const { decomposeBrief } = await import("@/lib/delivery/ai");

      const tasks = await decomposeBrief({
        brief:
          "Deliver 500 verified B2B leads (EU fintech compliance officers) with emails and LinkedIn URLs, plus a summary report. Two weeks.",
        nicheName: "Lead Research & Enrichment",
        sopRef: "SOP-LR-001",
      }).catch((err: unknown) => {
        if (err instanceof Error && /credit balance/i.test(err.message)) {
          console.warn(
            "SKIPPED live decomposition test: Anthropic account unfunded.",
          );
          ctx.skip();
        }
        throw err;
      });

      expect(tasks.length).toBeGreaterThanOrEqual(3);
      expect(tasks.some((t) => t.assignee_type === "ai")).toBe(true);
      expect(tasks.some((t) => t.assignee_type === "contractor")).toBe(true);
      for (const t of tasks) {
        expect(t.title.length).toBeGreaterThan(3);
        expect(t.estimated_hours).toBeGreaterThanOrEqual(0);
      }
    },
    90_000,
  );
});
