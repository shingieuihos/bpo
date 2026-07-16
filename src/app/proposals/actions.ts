"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addWinningProposalToCorpus,
  approveAndMarkSent,
  isProposalOutcome,
  recordOutcome,
} from "@/lib/proposals/approve";
import { draftProposalForOpportunity } from "@/lib/proposals/draft";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Auth + membership: every proposal action starts here. */
async function requireActor(): Promise<{ orgId: string; userId: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) throw new Error("not signed in");

  const { data: membership, error: memberError } = await supabase
    .from("org_members")
    .select("org_id")
    .limit(1)
    .maybeSingle();
  if (memberError || !membership) throw new Error("no org membership");
  return { orgId: membership.org_id, userId: String(data.claims.sub) };
}

export async function draftProposal(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const opportunityId = String(formData.get("opportunity_id") ?? "");
  if (!opportunityId) throw new Error("missing opportunity");

  const { proposalId } = await draftProposalForOpportunity({
    opportunityId,
    orgId,
    actorId: userId,
  });
  revalidatePath("/opportunities");
  redirect(`/proposals/${proposalId}`);
}

export async function saveFinal(formData: FormData): Promise<void> {
  const { orgId } = await requireActor();
  const proposalId = String(formData.get("proposal_id") ?? "");
  const final = String(formData.get("final") ?? "");
  if (!proposalId) throw new Error("missing proposal");

  // Authed client → RLS enforces org scope on the update.
  const supabase = await createClient();
  const { error } = await supabase
    .from("proposals")
    .update({ final })
    .eq("id", proposalId)
    .eq("org_id", orgId)
    .neq("status", "sent"); // sent proposals are immutable in the app
  if (error) throw new Error("failed to save final text");
  revalidatePath(`/proposals/${proposalId}`);
}

/**
 * THE approval gate trigger. Reachable only from the proposal detail page,
 * only with a signed-in session. See src/lib/proposals/approve.ts for the
 * invariants; there is no other route to status 'sent'.
 */
export async function approveProposal(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const proposalId = String(formData.get("proposal_id") ?? "");
  if (!proposalId) throw new Error("missing proposal");

  await approveAndMarkSent({ proposalId, orgId, approverId: userId });
  revalidatePath(`/proposals/${proposalId}`);
  revalidatePath("/proposals");
}

export async function setOutcome(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const proposalId = String(formData.get("proposal_id") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!proposalId || !isProposalOutcome(outcome)) throw new Error("invalid input");

  await recordOutcome({ proposalId, orgId, actorId: userId, outcome });

  // Learning loop: fold winners back into the RAG corpus (idempotent-ish:
  // skip if an asset for this proposal already exists).
  if (outcome === "won") {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("audit_events")
      .select("id")
      .eq("org_id", orgId)
      .eq("action", "asset.created_from_won_proposal")
      .contains("metadata", { proposal_id: proposalId })
      .limit(1);
    if (!existing || existing.length === 0) {
      await addWinningProposalToCorpus({ proposalId, orgId, actorId: userId });
    }
  }
  revalidatePath(`/proposals/${proposalId}`);
}
