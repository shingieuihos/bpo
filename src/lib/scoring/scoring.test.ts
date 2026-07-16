import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEIGHTS,
  compositeScore,
  parseWeights,
} from "@/lib/scoring/composite";
import { validateScores } from "@/lib/scoring/schema";

describe("validateScores (strict JSON parsing)", () => {
  const good = {
    fit: 80,
    margin_potential: 65,
    urgency: 40,
    effort: 55,
    rationale: "Strong niche match with a stated budget.",
  };

  it("accepts a valid payload", () => {
    expect(validateScores(good)).toEqual(good);
  });

  it("rejects out-of-range, non-integer, and missing values", () => {
    expect(validateScores({ ...good, fit: 101 })).toBeNull();
    expect(validateScores({ ...good, urgency: -1 })).toBeNull();
    expect(validateScores({ ...good, effort: 55.5 })).toBeNull();
    expect(validateScores({ ...good, margin_potential: "70" })).toBeNull();
    const missingRationale: Record<string, unknown> = { ...good };
    delete missingRationale.rationale;
    expect(validateScores(missingRationale)).toBeNull();
    expect(validateScores({ ...good, rationale: "   " })).toBeNull();
  });

  it("rejects malformed roots", () => {
    expect(validateScores(null)).toBeNull();
    expect(validateScores("not json object")).toBeNull();
    expect(validateScores([good])).toBeNull();
  });

  it("caps runaway rationales", () => {
    const result = validateScores({ ...good, rationale: "x".repeat(5000) });
    expect(result?.rationale).toHaveLength(1000);
  });
});

describe("compositeScore", () => {
  const scores = {
    fit_score: 80,
    margin_potential_score: 60,
    urgency_score: 40,
    effort_score: 30, // low effort → attractive
  };

  it("computes the weighted composite with effort inverted", () => {
    // (80*35 + 60*30 + 40*15 + 70*20) / 100 = 66.0
    expect(compositeScore(scores, DEFAULT_WEIGHTS)).toBe(66);
  });

  it("reweighting changes the ranking", () => {
    const urgencyHeavy = { fit: 10, margin: 10, urgency: 70, effort: 10 };
    const a = compositeScore(scores, urgencyHeavy)!;
    const b = compositeScore(scores, DEFAULT_WEIGHTS)!;
    expect(a).not.toBe(b);
    // Urgency-heavy weighting should drag the composite toward urgency=40.
    expect(a).toBeLessThan(b);
  });

  it("returns null when any subscore is missing", () => {
    expect(compositeScore({ ...scores, fit_score: null })).toBeNull();
  });

  it("returns null for degenerate zero weights", () => {
    expect(
      compositeScore(scores, { fit: 0, margin: 0, urgency: 0, effort: 0 }),
    ).toBeNull();
  });

  it("perfect opportunity scores 100, worst scores 0", () => {
    expect(
      compositeScore({
        fit_score: 100,
        margin_potential_score: 100,
        urgency_score: 100,
        effort_score: 0,
      }),
    ).toBe(100);
    expect(
      compositeScore({
        fit_score: 0,
        margin_potential_score: 0,
        urgency_score: 0,
        effort_score: 100,
      }),
    ).toBe(0);
  });
});

describe("parseWeights", () => {
  it("returns defaults for empty/invalid settings", () => {
    expect(parseWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(parseWeights({})).toEqual(DEFAULT_WEIGHTS);
    expect(parseWeights({ scoring_weights: "bad" })).toEqual(DEFAULT_WEIGHTS);
  });

  it("merges stored weights with per-field fallback", () => {
    expect(
      parseWeights({ scoring_weights: { fit: 50, effort: 500 } }),
    ).toEqual({ ...DEFAULT_WEIGHTS, fit: 50 });
  });
});
