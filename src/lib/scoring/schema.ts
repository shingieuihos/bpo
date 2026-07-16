/**
 * Score shape shared by the Claude call, the DB write, and the tests.
 *
 * The API's structured outputs guarantee the JSON matches the schema
 * *structurally*; numeric RANGES are not enforceable in the schema
 * (unsupported constraint), so validateScores() checks them here.
 */

export interface OpportunityScores {
  fit: number;
  margin_potential: number;
  urgency: number;
  effort: number;
  rationale: string;
}

/** JSON Schema sent as output_config.format — objects require additionalProperties:false. */
export const SCORES_JSON_SCHEMA = {
  type: "object",
  properties: {
    fit: {
      type: "integer",
      description: "0-100: how well this opportunity matches the niche's positioning and services",
    },
    margin_potential: {
      type: "integer",
      description: "0-100: likely gross margin given budget, pricing model, and target margin",
    },
    urgency: {
      type: "integer",
      description: "0-100: how quickly the client needs to move",
    },
    effort: {
      type: "integer",
      description: "0-100: delivery effort required — HIGHER means MORE work",
    },
    rationale: {
      type: "string",
      description: "One sentence explaining the standout factor of this scoring",
    },
  },
  required: ["fit", "margin_potential", "urgency", "effort", "rationale"],
  additionalProperties: false,
} as const;

/**
 * Strict parse of a claimed scores payload. Returns null when anything is
 * missing, non-integer, or out of range — callers treat null as a scoring
 * failure (retried by the queue), never as partial data.
 */
export function validateScores(raw: unknown): OpportunityScores | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const inRange = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;

  if (
    !inRange(obj.fit) ||
    !inRange(obj.margin_potential) ||
    !inRange(obj.urgency) ||
    !inRange(obj.effort) ||
    typeof obj.rationale !== "string" ||
    !obj.rationale.trim()
  ) {
    return null;
  }

  return {
    fit: obj.fit,
    margin_potential: obj.margin_potential,
    urgency: obj.urgency,
    effort: obj.effort,
    rationale: obj.rationale.trim().slice(0, 1000),
  };
}
