/**
 * Approval-gate acceptance tests against the live database:
 * edit → approve → audit-logged works; the gate's invariants hold
 * (no approver → refused; empty final → refused; double-approval → refused;
 * outcome recording; won → corpus). Auto-skips without Supabase creds.
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
const TIMEOUT = 40_000;

describe.skipIf(!haveCreds)("proposal approval gate (live database)", () => {
  let admin: SupabaseClient<Database>;
  let gate: typeof import("@/lib/proposals/approve");
  let orgId: string;
  let userId: string;
  let opportunityId: string;

  async function makeProposal(withFinal: boolean): Promise<string> {
    const { data, error } = await admin
      .from("proposals")
      .insert({
        org_id: orgId,
        opportunity_id: opportunityId,
        draft: "AI draft text",
        final: withFinal ? "Final text the human will send." : null,
        status: "draft",
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
    gate = await import("@/lib/proposals/approve");

    admin = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Throwaway human approver (the signup trigger provisions their org).
    const email = `gate-${crypto.randomUUID()}@example.com`;
    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email,
      password: `Gate!${crypto.randomUUID()}`,
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = user.user.id;

    const { data: membership } = await admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", userId)
      .single();
    orgId = membership!.org_id;

    const { data: opp, error: oppError } = await admin
      .from("opportunities")
      .insert({
        org_id: orgId,
        source: "owned_inbound",
        title: "gate test opportunity",
        currency: "USD",
        status: "drafting",
      })
      .select("id")
      .single();
    if (oppError) throw oppError;
    opportunityId = opp.id;
  }, TIMEOUT);

  afterAll(async () => {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }, TIMEOUT);

  it(
    "edit → approve stamps approved_by + sent_at, audits, advances the opportunity",
    async () => {
      const proposalId = await makeProposal(true);

      await gate.approveAndMarkSent({ proposalId, orgId, approverId: userId });

      const { data: p } = await admin
        .from("proposals")
        .select("status, approved_by, sent_at")
        .eq("id", proposalId)
        .single();
      expect(p).toMatchObject({ status: "sent", approved_by: userId });
      expect(p!.sent_at).toBeTruthy();

      const { data: audit } = await admin
        .from("audit_events")
        .select("actor, action, entity_id")
        .eq("org_id", orgId)
        .eq("action", "proposal.approved_and_marked_sent")
        .eq("entity_id", proposalId);
      expect(audit).toHaveLength(1);
      expect(audit![0].actor).toBe(userId);

      const { data: opp } = await admin
        .from("opportunities")
        .select("status")
        .eq("id", opportunityId)
        .single();
      expect(opp!.status).toBe("proposed");
    },
    TIMEOUT,
  );

  it(
    "refuses approval without a human approver id",
    async () => {
      const proposalId = await makeProposal(true);
      await expect(
        gate.approveAndMarkSent({ proposalId, orgId, approverId: "" }),
      ).rejects.toThrow(/human approver/);
    },
    TIMEOUT,
  );

  it(
    "refuses approval when no final text exists",
    async () => {
      const proposalId = await makeProposal(false);
      await expect(
        gate.approveAndMarkSent({ proposalId, orgId, approverId: userId }),
      ).rejects.toThrow(/no final text/);
    },
    TIMEOUT,
  );

  it(
    "refuses double-approval",
    async () => {
      const proposalId = await makeProposal(true);
      await gate.approveAndMarkSent({ proposalId, orgId, approverId: userId });
      await expect(
        gate.approveAndMarkSent({ proposalId, orgId, approverId: userId }),
      ).rejects.toThrow(/already sent/);
    },
    TIMEOUT,
  );

  it(
    "records outcomes on sent proposals only, and 'won' joins the corpus",
    async () => {
      const proposalId = await makeProposal(true);

      await expect(
        gate.recordOutcome({ proposalId, orgId, actorId: userId, outcome: "won" }),
      ).rejects.toThrow(/only be recorded on sent/);

      await gate.approveAndMarkSent({ proposalId, orgId, approverId: userId });
      await gate.recordOutcome({ proposalId, orgId, actorId: userId, outcome: "won" });

      const { data: p } = await admin
        .from("proposals")
        .select("outcome")
        .eq("id", proposalId)
        .single();
      expect(p!.outcome).toBe("won");

      const { assetId } = await gate.addWinningProposalToCorpus({
        proposalId,
        orgId,
        actorId: userId,
      });
      const { data: asset } = await admin
        .from("assets")
        .select("type, content")
        .eq("id", assetId)
        .single();
      expect(asset!.type).toBe("winning_proposal");
      expect(asset!.content).toContain("Final text the human will send.");
    },
    TIMEOUT,
  );
});
