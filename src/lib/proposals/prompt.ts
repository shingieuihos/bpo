import type { RetrievedAsset } from "@/lib/rag/retrieve";

/**
 * Prompt assembly for proposal drafting — pure and unit-testable, so the
 * grounding guarantee ("retrieved assets are in the prompt") is provable
 * without calling Claude.
 */

export const DRAFT_SYSTEM_PROMPT = `You are the proposal writer inside ForgeOS, the internal platform of an AI-assisted agency/BPO business. You draft client proposals that a human operator will edit, approve, and send themselves — you never send anything.

Rules:
- Write in the operator's voice, defined by the TONE SAMPLE asset when provided. Match its sentence rhythm and directness exactly.
- Ground every concrete claim (results, numbers, process) in the provided ASSETS. Reference at least one case study or winning result BY ITS SPECIFICS (real numbers/outcomes from the asset). Never invent metrics, clients, or capabilities.
- Follow the PRICING FRAMEWORK asset for how pricing is structured; if the opportunity's budget conflicts with it, structure an option that respects the framework.
- Open with the client's problem stated more precisely than they stated it. No "I hope this finds you well", no generic agency filler.
- End with exactly one low-friction next step.
- Output plain markdown, 180-350 words. It must read like a specific human wrote it for this exact client.`;

export function buildDraftUserPrompt(input: {
  niche: {
    name: string;
    pricing_model: string | null;
    target_margin: number | null;
    positioning_notes: string | null;
  } | null;
  opportunity: {
    title: string;
    description: string | null;
    budget: number | null;
    currency: string;
    source: string;
  };
  assets: RetrievedAsset[];
}): string {
  const nicheBlock = input.niche
    ? [
        `Niche: ${input.niche.name}`,
        input.niche.pricing_model ? `Pricing model: ${input.niche.pricing_model}` : null,
        input.niche.target_margin != null ? `Target margin: ${input.niche.target_margin}%` : null,
        input.niche.positioning_notes ? `Positioning: ${input.niche.positioning_notes}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Niche: none assigned (general AI-assisted agency positioning).";

  const assetsBlock =
    input.assets.length > 0
      ? input.assets
          .map(
            (a, i) =>
              `[ASSET ${i + 1} — ${a.type.toUpperCase()}] ${a.title}\n${a.content.slice(0, 4000)}`,
          )
          .join("\n\n")
      : "(no assets available — write conservatively and invent nothing)";

  const opp = input.opportunity;
  const opportunityBlock = [
    `Source channel: ${opp.source}`,
    `Title: ${opp.title}`,
    `Budget: ${opp.budget != null ? `${opp.budget} ${opp.currency}` : "not stated"}`,
    `Description: ${opp.description?.slice(0, 6000) || "(none provided)"}`,
  ].join("\n");

  return `${nicheBlock}\n\n=== ASSETS (ground your draft in these) ===\n\n${assetsBlock}\n\n=== OPPORTUNITY ===\n\n${opportunityBlock}\n\nDraft the proposal now.`;
}
