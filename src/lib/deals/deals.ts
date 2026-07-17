import "server-only";

import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export type DealStage = Database["public"]["Enums"]["deal_stage"];

const STAGES: DealStage[] = [
  "qualifying",
  "negotiation",
  "contract_sent",
  "won",
  "lost",
];
export function isDealStage(v: string): v is DealStage {
  return (STAGES as string[]).includes(v);
}

/**
 * Create a deal from a SENT proposal — the pipeline handoff point.
 * Initial value defaults to the opportunity's budget; stage starts at
 * 'qualifying' with a neutral win probability the operator tunes.
 */
export async function createDealFromProposal(params: {
  proposalId: string;
  orgId: string;
  actorId: string;
}): Promise<{ dealId: string }> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  const admin = createAdminClient();

  const { data: proposal, error } = await admin
    .from("proposals")
    .select("id, status, opportunity_id, opportunities (id, title, budget, currency)")
    .eq("id", params.proposalId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !proposal) throw new Error("proposal not found");
  if (proposal.status !== "sent") {
    throw new Error("deals are created from sent proposals");
  }

  const { data: existing } = await admin
    .from("deals")
    .select("id")
    .eq("org_id", params.orgId)
    .eq("opportunity_id", proposal.opportunity_id)
    .limit(1);
  if (existing && existing.length > 0) {
    return { dealId: existing[0].id }; // idempotent — one deal per opportunity
  }

  const { data: deal, error: insertError } = await admin
    .from("deals")
    .insert({
      org_id: params.orgId,
      opportunity_id: proposal.opportunity_id,
      stage: "qualifying",
      value: proposal.opportunities?.budget ?? null,
      currency: proposal.opportunities?.currency ?? "USD",
      win_probability: 50,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`deal insert failed: ${insertError.message}`);

  await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.actorId,
    action: "deal.created",
    entity_type: "deal",
    entity_id: deal.id,
    metadata: { proposal_id: proposal.id, opportunity_id: proposal.opportunity_id },
  });

  return { dealId: deal.id };
}

/** Quick stage change from the board. Won/lost go through their own flows. */
export async function updateDealStage(params: {
  dealId: string;
  orgId: string;
  actorId: string;
  stage: DealStage;
}): Promise<void> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  if (params.stage === "won") {
    throw new Error("winning a deal requires the mark-won flow (it needs a client)");
  }
  const admin = createAdminClient();

  const { data: deal, error } = await admin
    .from("deals")
    .select("id, stage, opportunity_id")
    .eq("id", params.dealId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !deal) throw new Error("deal not found");

  const { error: updateError } = await admin
    .from("deals")
    .update({ stage: params.stage })
    .eq("id", deal.id);
  if (updateError) throw new Error(`stage update failed: ${updateError.message}`);

  if (params.stage === "lost" && deal.opportunity_id) {
    await admin
      .from("opportunities")
      .update({ status: "lost" })
      .eq("id", deal.opportunity_id)
      .neq("status", "won");
  }
}

/**
 * Win a deal. A won deal MUST have a client record — pass an existing
 * clientId, or a newClient to create one. Stamps first_won_at on first win,
 * advances the opportunity to 'won', audits the event.
 */
export async function markDealWon(params: {
  dealId: string;
  orgId: string;
  actorId: string;
  clientId?: string | null;
  newClient?: { name: string; email?: string | null; source?: string | null } | null;
}): Promise<{ clientId: string }> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  const admin = createAdminClient();

  const { data: deal, error } = await admin
    .from("deals")
    .select("id, stage, client_id, opportunity_id, value")
    .eq("id", params.dealId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !deal) throw new Error("deal not found");
  if (deal.stage === "won") throw new Error("deal is already won");

  let clientId = params.clientId ?? deal.client_id ?? null;
  if (!clientId) {
    const name = params.newClient?.name?.trim();
    if (!name) throw new Error("winning a deal requires a client (existing or new)");
    const { data: client, error: clientError } = await admin
      .from("clients")
      .insert({
        org_id: params.orgId,
        name,
        contact: params.newClient?.email ? { email: params.newClient.email } : {},
        source: params.newClient?.source ?? null,
      })
      .select("id")
      .single();
    if (clientError) throw new Error(`client insert failed: ${clientError.message}`);
    clientId = client.id;
  } else {
    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("org_id", params.orgId)
      .maybeSingle();
    if (!client) throw new Error("client not found in this org");
  }

  const wonAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("deals")
    .update({ stage: "won", client_id: clientId, win_probability: 100, won_at: wonAt })
    .eq("id", deal.id);
  if (updateError) throw new Error(`deal win failed: ${updateError.message}`);

  // First win stamps the client's first_won_at.
  await admin
    .from("clients")
    .update({ first_won_at: wonAt })
    .eq("id", clientId)
    .is("first_won_at", null);

  if (deal.opportunity_id) {
    await admin
      .from("opportunities")
      .update({ status: "won" })
      .eq("id", deal.opportunity_id);
  }

  await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.actorId,
    action: "deal.won",
    entity_type: "deal",
    entity_id: deal.id,
    metadata: { client_id: clientId, value: deal.value },
  });

  return { clientId };
}

/**
 * POPIA affordance: assemble everything held about a client for export.
 * (Deletion is a plain cascade delete via the clients page, RLS/org-checked.)
 */
export async function exportClientData(params: {
  clientId: string;
  orgId: string;
}): Promise<Record<string, unknown>> {
  const admin = createAdminClient();

  const { data: client, error } = await admin
    .from("clients")
    .select("*")
    .eq("id", params.clientId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !client) throw new Error("client not found");

  const { data: deals } = await admin
    .from("deals")
    .select("*, opportunities (title, source, url)")
    .eq("org_id", params.orgId)
    .eq("client_id", params.clientId);

  return {
    exported_at: new Date().toISOString(),
    client,
    deals: deals ?? [],
  };
}
