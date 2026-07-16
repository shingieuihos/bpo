import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  SCORES_JSON_SCHEMA,
  validateScores,
  type OpportunityScores,
} from "@/lib/scoring/schema";

/** Model comes from env (per the locked stack); a safe modern default otherwise. */
export function scoringModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-8";
}

export interface ScoringInput {
  title: string;
  description: string | null;
  budget: number | null;
  currency: string;
  source: string;
  niche: {
    name: string;
    pricing_model: string | null;
    target_margin: number | null;
    positioning_notes: string | null;
  } | null;
}

/** Stable system prompt (cache-friendly: volatile content goes in the user turn). */
const SYSTEM_PROMPT = `You are the opportunity-scoring engine inside ForgeOS, the internal platform of an AI-assisted agency/BPO business. The operator sources client work (any service niche — support ops, lead research, data work, admin, and more) and needs each incoming opportunity scored for triage.

Score the opportunity on four dimensions, each an integer 0-100:
- fit: how well it matches the niche's positioning and services (or general agency deliverability when no niche is given). 0 = completely outside our capabilities, 100 = exactly what we sell.
- margin_potential: likely gross margin given the stated budget, the niche's pricing model, and its target margin. Low or absent budgets with heavy scope score low.
- urgency: how fast the client appears to need to move (deadlines, "start immediately", live pain). 0 = no time pressure signals.
- effort: how much delivery work it requires — HIGHER means MORE work. A quick one-off scores low; an ongoing heavy engagement scores high.

Also produce "rationale": ONE sentence naming the standout factor (positive or negative). Be decisive and use the full 0-100 range; middling 50s everywhere is a scoring failure unless truly warranted.`;

export type Scorer = (input: ScoringInput) => Promise<OpportunityScores>;

/**
 * Score one opportunity with Claude. Structured outputs guarantee the JSON
 * shape; validateScores() enforces the 0-100 ranges. Throws on refusal,
 * truncation, or invalid payloads — the queue worker owns retries.
 */
export const scoreOpportunity: Scorer = async (input) => {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const nicheBlock = input.niche
    ? [
        `Niche: ${input.niche.name}`,
        input.niche.pricing_model ? `Pricing model: ${input.niche.pricing_model}` : null,
        input.niche.target_margin != null ? `Target margin: ${input.niche.target_margin}%` : null,
        input.niche.positioning_notes ? `Positioning: ${input.niche.positioning_notes}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "Niche: none assigned — score against a general AI-assisted agency/BPO capability set.";

  const opportunityBlock = [
    `Source channel: ${input.source}`,
    `Title: ${input.title}`,
    `Budget: ${input.budget != null ? `${input.budget} ${input.currency}` : "not stated"}`,
    `Description: ${input.description?.slice(0, 6000) || "(none provided)"}`,
  ].join("\n");

  const response = await client.messages.create({
    model: scoringModel(),
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: SCORES_JSON_SCHEMA,
      },
    },
    messages: [
      {
        role: "user",
        content: `${nicheBlock}\n\n---\n\n${opportunityBlock}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("scoring declined by model safety systems");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("scoring output truncated (max_tokens)");
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) throw new Error("scoring response contained no text block");

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error("scoring response was not valid JSON");
  }

  const scores = validateScores(parsed);
  if (!scores) throw new Error("scoring response failed range validation");
  return scores;
};
