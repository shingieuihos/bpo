/**
 * Phase 5 acceptance test, live database: "an opportunity can be walked all
 * the way to a won deal + client record."
 *
 * Walks the full funnel: opportunity → proposal (drafted + human-approved
 * via the Phase 4 gate) → deal → stage changes → won with a new client —
 * asserting stamps, audit rows, LTV view, and the POPIA export shape.
 * Auto-skips without Supabase creds.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

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

describe.skipIf(!haveCreds)("pipeline walkthrough (live database)", () => {
  let admin: SupabaseClient<Database>;
  let deals: typeof import("@/lib/deals/deals");
  let gate: typeof import("@/lib/proposals/approve");
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    deals = await import("@/lib/deals/deals");
    gate = await import("@/lib/proposals/approve");

    admin = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await admin.auth.admin.createUser({
      email: `pipeline-${crypto.randomUUID()}@example.com`,
      password: `Pipe!${crypto.randomUUID()}`,
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
  }, TIMEOUT);

  afterAll(async () => {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, TIMEOUT);

  it(
    "opportunity → proposal → deal → stages → won deal + client record",
    async () => {
      // 1. Opportunity arrives (ingestion equivalent).
      const { data: opp } = await admin
        .from("opportunities")
        .insert({
          org_id: orgId,
          source: "owned_inbound",
          title: "Walkthrough: support pod for Acme",
          budget: 4200,
          currency: "USD",
          status: "scored",
        })
        .select("id")
        .single();

      // 2. Proposal drafted, finalized, human-approved (Phase 4 gate).
      const { data: proposal } = await admin
        .from("proposals")
        .insert({
          org_id: orgId,
          opportunity_id: opp!.id,
          draft: "draft",
          final: "final text the operator sent",
          status: "draft",
        })
        .select("id")
        .single();
      await gate.approveAndMarkSent({
        proposalId: proposal!.id,
        orgId,
        approverId: userId,
      });

      // 3. Deal created from the sent proposal — value defaults from budget.
      const { dealId } = await deals.createDealFromProposal({
        proposalId: proposal!.id,
        orgId,
        actorId: userId,
      });
      const { data: freshDeal } = await admin
        .from("deals")
        .select("stage, value, opportunity_id")
        .eq("id", dealId)
        .single();
      expect(freshDeal).toMatchObject({ stage: "qualifying", value: 4200 });

      // Idempotent: re-creating returns the same deal.
      const again = await deals.createDealFromProposal({
        proposalId: proposal!.id,
        orgId,
        actorId: userId,
      });
      expect(again.dealId).toBe(dealId);

      // 4. Quick stage changes walk the board.
      await deals.updateDealStage({ dealId, orgId, actorId: userId, stage: "negotiation" });
      await deals.updateDealStage({ dealId, orgId, actorId: userId, stage: "contract_sent" });

      // 'won' via quick-change is refused — it needs the client flow.
      await expect(
        deals.updateDealStage({ dealId, orgId, actorId: userId, stage: "won" }),
      ).rejects.toThrow(/mark-won/);

      // 5. Win it with a NEW client.
      const { clientId } = await deals.markDealWon({
        dealId,
        orgId,
        actorId: userId,
        newClient: { name: "Acme Ltd", email: "ops@acme.example" },
      });

      const { data: wonDeal } = await admin
        .from("deals")
        .select("stage, client_id, win_probability")
        .eq("id", dealId)
        .single();
      expect(wonDeal).toMatchObject({ stage: "won", client_id: clientId, win_probability: 100 });

      const { data: client } = await admin
        .from("clients")
        .select("name, first_won_at, data_classification, org_id")
        .eq("id", clientId)
        .single();
      expect(client!.name).toBe("Acme Ltd");
      expect(client!.first_won_at).toBeTruthy();
      expect(client!.data_classification).toBe("personal_data"); // POPIA default
      expect(client!.org_id).toBe(orgId); // org-scoped

      const { data: wonOpp } = await admin
        .from("opportunities")
        .select("status")
        .eq("id", opp!.id)
        .single();
      expect(wonOpp!.status).toBe("won");

      // 6. Audit trail recorded the win.
      const { data: audit } = await admin
        .from("audit_events")
        .select("action")
        .eq("org_id", orgId)
        .eq("entity_id", dealId);
      expect(audit!.map((a) => a.action)).toEqual(
        expect.arrayContaining(["deal.created", "deal.won"]),
      );

      // 7. LTV view reflects the won value.
      const { data: ltv } = await admin
        .from("v_client_lifetime_value")
        .select("lifetime_value, won_deals")
        .eq("client_id", clientId)
        .single();
      expect(Number(ltv!.lifetime_value)).toBe(4200);
      expect(ltv!.won_deals).toBe(1);

      // 8. POPIA export contains the client and its deals.
      const exported = await deals.exportClientData({ clientId, orgId });
      expect(exported.client).toMatchObject({ name: "Acme Ltd" });
      expect(exported.deals).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "losing a deal marks the opportunity lost",
    async () => {
      const { data: opp } = await admin
        .from("opportunities")
        .insert({
          org_id: orgId,
          source: "outbound",
          title: "Walkthrough: lost deal",
          status: "proposed",
          currency: "USD",
        })
        .select("id")
        .single();
      const { data: deal } = await admin
        .from("deals")
        .insert({ org_id: orgId, opportunity_id: opp!.id, stage: "negotiation" })
        .select("id")
        .single();

      await deals.updateDealStage({
        dealId: deal!.id,
        orgId,
        actorId: userId,
        stage: "lost",
      });

      const { data: lostOpp } = await admin
        .from("opportunities")
        .select("status")
        .eq("id", opp!.id)
        .single();
      expect(lostOpp!.status).toBe("lost");
    },
    TIMEOUT,
  );
});
