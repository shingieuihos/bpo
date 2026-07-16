/**
 * Composite ranking score — pure math, re-weightable by the operator.
 *
 * Weights are integer percents stored in organizations.settings.scoring_weights.
 * Effort is INVERTED (high effort = less attractive), so the composite is:
 *   (fit*w.fit + margin*w.margin + urgency*w.urgency + (100-effort)*w.effort)
 *   / (w.fit + w.margin + w.urgency + w.effort)
 */

export interface ScoringWeights {
  fit: number;
  margin: number;
  urgency: number;
  effort: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  fit: 35,
  margin: 30,
  urgency: 15,
  effort: 20,
};

/** Parse weights from org settings jsonb; falls back to defaults per-field. */
export function parseWeights(settings: unknown): ScoringWeights {
  const raw =
    typeof settings === "object" && settings !== null
      ? (settings as Record<string, unknown>).scoring_weights
      : undefined;
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100
      ? v
      : fallback;
  return {
    fit: num(obj.fit, DEFAULT_WEIGHTS.fit),
    margin: num(obj.margin, DEFAULT_WEIGHTS.margin),
    urgency: num(obj.urgency, DEFAULT_WEIGHTS.urgency),
    effort: num(obj.effort, DEFAULT_WEIGHTS.effort),
  };
}

export interface ScoredFields {
  fit_score: number | null;
  margin_potential_score: number | null;
  urgency_score: number | null;
  effort_score: number | null;
}

/**
 * Composite 0-100 score, or null when the opportunity is not fully scored
 * (unscored rows sort after scored ones, newest first — handled by callers).
 */
export function compositeScore(
  scores: ScoredFields,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number | null {
  const { fit_score, margin_potential_score, urgency_score, effort_score } =
    scores;
  if (
    fit_score == null ||
    margin_potential_score == null ||
    urgency_score == null ||
    effort_score == null
  ) {
    return null;
  }
  const totalWeight =
    weights.fit + weights.margin + weights.urgency + weights.effort;
  if (totalWeight <= 0) return null;

  const weighted =
    fit_score * weights.fit +
    margin_potential_score * weights.margin +
    urgency_score * weights.urgency +
    (100 - effort_score) * weights.effort;

  return Math.round((weighted / totalWeight) * 10) / 10;
}
