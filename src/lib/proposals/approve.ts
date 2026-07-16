import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE HUMAN-IN-THE-LOOP APPROVAL GATE — compliance-critical.
 *
 *  This module is the ONLY place in the codebase that can move a proposal to
 *  status 'sent' (enforced by test: src/lib/proposals/no-auto-send.test.ts).
 *
 *  Invariants:
 *  - approverId is REQUIRED and must be a real human user id — callers obtain
 *    it from an authenticated Supabase session, never from config or code.
 *  - approved_by + sent_at are stamped, and an audit_events row is written in
 *    the same flow. The audit table is append-only (RLS + revoked grants).
 *  - "Sent" is a RECORD of the human having sent the proposal themselves,
 *    outside this system. ForgeOS never transmits proposals to any
 *    marketplace or third party, and never will.
 * ══════════════════════════════════════════════════════════════════════════
 */
export async function approveAndMarkSent(params: {
  proposalId: string;
  orgId: string;
  approverId: string;
}): Promise<void> {
  if (!params.approverId) {
    throw new Error("approval requires a signed-in human approver");
  }
  const admin = createAdminClient();

  const { data: proposal, error } = await admin
    .from("proposals")
    .select("id, org_id, status, final, opportunity_id")
    .eq("id", params.proposalId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !proposal) throw new Error("proposal not found");
  if (proposal.status === "sent") throw new Error("proposal is already sent");
  if (!proposal.final?.trim()) {
    throw new Error(
      "proposal has no final text — edit the draft into a final before approving",
    );
  }

  const sentAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("proposals")
    .update({
      status: "sent",
      approved_by: params.approverId,
      sent_at: sentAt,
    })
    .eq("id", proposal.id)
    .eq("status", proposal.status); // no concurrent double-approval
  if (updateError) throw new Error(`approval write failed: ${updateError.message}`);

  const { error: auditError } = await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.approverId,
    action: "proposal.approved_and_marked_sent",
    entity_type: "proposal",
    entity_id: proposal.id,
    metadata: {
      opportunity_id: proposal.opportunity_id,
      sent_at: sentAt,
      note: "human approved; sending performed by the operator outside ForgeOS",
    },
  });
  if (auditError) {
    // The audit trail is a hard requirement — surface loudly, never swallow.
    throw new Error(`audit write failed after approval: ${auditError.message}`);
  }

  if (proposal.opportunity_id) {
    await admin
      .from("opportunities")
      .update({ status: "proposed" })
      .eq("id", proposal.opportunity_id)
      .in("status", ["new", "scored", "drafting"]);
  }
}

const OUTCOMES = [
  "pending",
  "reply",
  "shortlisted",
  "won",
  "lost",
  "no_response",
] as const;
export type ProposalOutcome = (typeof OUTCOMES)[number];

export function isProposalOutcome(v: string): v is ProposalOutcome {
  return (OUTCOMES as readonly string[]).includes(v);
}

/** Record how a sent proposal fared — feeds the learning loop. */
export async function recordOutcome(params: {
  proposalId: string;
  orgId: string;
  actorId: string;
  outcome: ProposalOutcome;
}): Promise<void> {
  if (!params.actorId) throw new Error("recording an outcome requires a signed-in user");
  const admin = createAdminClient();

  const { data: proposal, error } = await admin
    .from("proposals")
    .select("id, status")
    .eq("id", params.proposalId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !proposal) throw new Error("proposal not found");
  if (proposal.status !== "sent") {
    throw new Error("outcomes can only be recorded on sent proposals");
  }

  const { error: updateError } = await admin
    .from("proposals")
    .update({ outcome: params.outcome })
    .eq("id", proposal.id);
  if (updateError) throw new Error(`outcome write failed: ${updateError.message}`);

  await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.actorId,
    action: "proposal.outcome_recorded",
    entity_type: "proposal",
    entity_id: proposal.id,
    metadata: { outcome: params.outcome },
  });
}

/**
 * Learning loop: fold a WON proposal's final text back into the RAG corpus
 * as a winning_proposal asset, so future drafts are grounded in what wins.
 */
export async function addWinningProposalToCorpus(params: {
  proposalId: string;
  orgId: string;
  actorId: string;
}): Promise<{ assetId: string }> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  const admin = createAdminClient();

  const { data: proposal, error } = await admin
    .from("proposals")
    .select("id, final, outcome, opportunity_id, opportunities (title, niche_id)")
    .eq("id", params.proposalId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !proposal) throw new Error("proposal not found");
  if (proposal.outcome !== "won") throw new Error("only won proposals join the corpus");
  if (!proposal.final?.trim()) throw new Error("proposal has no final text");

  const title = `Winning proposal: ${proposal.opportunities?.title ?? "untitled opportunity"}`;
  const { data: asset, error: assetError } = await admin
    .from("assets")
    .insert({
      org_id: params.orgId,
      type: "winning_proposal",
      title: title.slice(0, 300),
      content: proposal.final,
      niche_id: proposal.opportunities?.niche_id ?? null,
    })
    .select("id")
    .single();
  if (assetError) throw new Error(`asset insert failed: ${assetError.message}`);

  await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.actorId,
    action: "asset.created_from_won_proposal",
    entity_type: "asset",
    entity_id: asset.id,
    metadata: { proposal_id: proposal.id },
  });

  return { assetId: asset.id };
}
