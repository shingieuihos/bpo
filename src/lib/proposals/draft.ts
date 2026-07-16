import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  DRAFT_SYSTEM_PROMPT,
  buildDraftUserPrompt,
} from "@/lib/proposals/prompt";
import { retrieveAssets } from "@/lib/rag/retrieve";
import { scoringModel } from "@/lib/scoring/score-opportunity";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Draft a proposal for an opportunity: retrieve grounding assets, call
 * Claude, store proposals.draft, advance the opportunity to 'drafting',
 * and audit the event. The caller (server action) owns auth/membership.
 *
 * Compliance: this creates a DRAFT only. Nothing here — or anywhere in this
 * codebase — sends a proposal anywhere; status 'sent' is reachable solely
 * through the human approval gate in approve.ts.
 */
export async function draftProposalForOpportunity(params: {
  opportunityId: string;
  orgId: string;
  actorId: string;
}): Promise<{ proposalId: string }> {
  const admin = createAdminClient();

  const { data: opp, error: oppError } = await admin
    .from("opportunities")
    .select(
      "id, org_id, title, description, budget, currency, source, status, niche_id, niches (name, pricing_model, target_margin, positioning_notes)",
    )
    .eq("id", params.opportunityId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (oppError || !opp) throw new Error("opportunity not found");

  const assets = await retrieveAssets({
    orgId: params.orgId,
    nicheId: opp.niche_id,
    queryText: `${opp.title}\n${opp.description ?? ""}`,
  });

  const client = new Anthropic();
  const response = await client.messages.create({
    model: scoringModel(),
    max_tokens: 4096,
    system: DRAFT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildDraftUserPrompt({
          niche: opp.niches,
          opportunity: opp,
          assets,
        }),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("drafting declined by model safety systems");
  }
  const draft = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!draft) throw new Error("draft response was empty");

  const { data: proposal, error: insertError } = await admin
    .from("proposals")
    .insert({
      org_id: params.orgId,
      opportunity_id: opp.id,
      draft,
      status: "draft",
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`proposal insert failed: ${insertError.message}`);

  if (opp.status === "new" || opp.status === "scored") {
    await admin
      .from("opportunities")
      .update({ status: "drafting" })
      .eq("id", opp.id);
  }

  await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.actorId,
    action: "proposal.drafted",
    entity_type: "proposal",
    entity_id: proposal.id,
    metadata: {
      opportunity_id: opp.id,
      grounded_on: assets.map((a) => ({ id: a.id, type: a.type, via: a.via })),
    },
  });

  return { proposalId: proposal.id };
}
