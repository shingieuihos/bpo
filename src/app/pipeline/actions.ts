"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createDealFromProposal,
  isDealStage,
  markDealWon,
  updateDealStage,
} from "@/lib/deals/deals";
import { createClient } from "@/lib/supabase/server";

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

export async function createDeal(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const proposalId = String(formData.get("proposal_id") ?? "");
  if (!proposalId) throw new Error("missing proposal");
  const { dealId } = await createDealFromProposal({ proposalId, orgId, actorId: userId });
  redirect(`/deals/${dealId}`);
}

export async function changeStage(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const dealId = String(formData.get("deal_id") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!dealId || !isDealStage(stage)) throw new Error("invalid input");
  await updateDealStage({ dealId, orgId, actorId: userId, stage });
  revalidatePath("/pipeline");
  revalidatePath(`/deals/${dealId}`);
}

export async function winDeal(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const dealId = String(formData.get("deal_id") ?? "");
  if (!dealId) throw new Error("missing deal");

  const existingClient = String(formData.get("client_id") ?? "").trim();
  const newClientName = String(formData.get("new_client_name") ?? "").trim();
  const newClientEmail = String(formData.get("new_client_email") ?? "").trim();

  const { clientId } = await markDealWon({
    dealId,
    orgId,
    actorId: userId,
    clientId: existingClient || null,
    newClient: newClientName
      ? { name: newClientName, email: newClientEmail || null, source: "pipeline" }
      : null,
  });
  revalidatePath("/pipeline");
  redirect(`/clients/${clientId}`);
}

export async function updateDealDetails(formData: FormData): Promise<void> {
  const { orgId } = await requireActor();
  const dealId = String(formData.get("deal_id") ?? "");
  if (!dealId) throw new Error("missing deal");

  const num = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    if (!raw) return null;
    const v = Number.parseFloat(raw);
    return Number.isFinite(v) ? v : null;
  };
  const winProb = num("win_probability");
  const nextActionAt = String(formData.get("next_action_at") ?? "").trim();

  // Authed client → RLS enforces org scope.
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({
      value: num("value"),
      estimated_delivery_cost: num("estimated_delivery_cost"),
      win_probability:
        winProb != null ? Math.min(100, Math.max(0, Math.round(winProb))) : null,
      next_action_at: nextActionAt ? new Date(nextActionAt).toISOString() : null,
      next_action_note: String(formData.get("next_action_note") ?? "").trim() || null,
    })
    .eq("id", dealId)
    .eq("org_id", orgId);
  if (error) throw new Error("deal update failed");
  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/pipeline");
}
