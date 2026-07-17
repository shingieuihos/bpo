import { describe, expect, it } from "vitest";

import { computeMetrics, type ReportDeal } from "@/lib/reporting/metrics";

/**
 * Phase 7 acceptance: "metrics compute correctly from real records (verify
 * against a manual calculation)". Every expectation below is hand-computed
 * from the fixture — the manual calculation IS the test.
 */

const deal = (over: Partial<ReportDeal> & { id: string; stage: ReportDeal["stage"] }): ReportDeal => ({
  value: null,
  currency: "USD",
  estimated_delivery_cost: null,
  actual_delivery_cost: null,
  gross_margin: null,
  win_probability: null,
  created_at: "2026-07-01T00:00:00Z",
  won_at: null,
  title: null,
  nicheName: null,
  ...over,
});

const FIXTURE: ReportDeal[] = [
  deal({ id: "a", stage: "qualifying", value: 1000, win_probability: 20 }),
  deal({ id: "b", stage: "negotiation", value: 2000, win_probability: 50 }),
  deal({ id: "c", stage: "contract_sent", value: 4000, win_probability: 80 }),
  // Won deal with ACTUAL costs (margin from DB): 5000 − 1250 = 3750
  deal({
    id: "d",
    stage: "won",
    value: 5000,
    actual_delivery_cost: 1250,
    gross_margin: 3750,
    nicheName: "Support Ops",
    won_at: "2026-07-05T10:00:00Z",
    title: "Acme support pod",
  }),
  // Won deal with only an ESTIMATE: 3000 − 1000 = 2000
  deal({
    id: "e",
    stage: "won",
    value: 3000,
    estimated_delivery_cost: 1000,
    gross_margin: 2000,
    nicheName: "Lead Research",
    won_at: "2026-06-20T10:00:00Z",
    title: "Fintech leads",
  }),
  deal({ id: "f", stage: "lost", value: 9999 }),
];

describe("computeMetrics — manual calculation cross-check", () => {
  const m = computeMetrics(FIXTURE);

  it("open pipeline: 1000 + 2000 + 4000 = 7000", () => {
    expect(m.openPipelineValue).toBe(7000);
  });

  it("weighted pipeline: 1000·0.2 + 2000·0.5 + 4000·0.8 = 4400", () => {
    expect(m.weightedPipelineValue).toBe(4400);
  });

  it("win rate: 2 won / (2 won + 1 lost) = 66.7%", () => {
    expect(m.wonCount).toBe(2);
    expect(m.lostCount).toBe(1);
    expect(m.winRate).toBeCloseTo(2 / 3, 5);
  });

  it("won revenue 8000, delivery cost 1250 + 1000 = 2250, margin 5750", () => {
    expect(m.totalWonValue).toBe(8000);
    expect(m.totalDeliveryCost).toBe(2250);
    expect(m.totalWonMargin).toBe(5750);
  });

  it("pipeline by stage counts and sums", () => {
    expect(m.pipelineByStage).toEqual([
      { stage: "qualifying", count: 1, value: 1000 },
      { stage: "negotiation", count: 1, value: 2000 },
      { stage: "contract_sent", count: 1, value: 4000 },
      { stage: "won", count: 2, value: 8000 },
      { stage: "lost", count: 1, value: 9999 },
    ]);
  });

  it("margin by niche: Support Ops 3750 > Lead Research 2000", () => {
    expect(m.marginByNiche).toEqual([
      { niche: "Support Ops", wonValue: 5000, deliveryCost: 1250, margin: 3750, deals: 1 },
      { niche: "Lead Research", wonValue: 3000, deliveryCost: 1000, margin: 2000, deals: 1 },
    ]);
  });

  it("margin per project sorted best-first", () => {
    expect(m.marginByProject.map((p) => [p.title, p.margin])).toEqual([
      ["Acme support pod", 3750],
      ["Fintech leads", 2000],
    ]);
  });

  it("cash timing: 2026-06 → 3000, 2026-07 → 5000 (ascending months)", () => {
    expect(m.cashByMonth).toEqual([
      { month: "2026-06", value: 3000 },
      { month: "2026-07", value: 5000 },
    ]);
  });

  it("single currency detected — no mixed-currency caveat needed", () => {
    expect(m.currencies).toEqual(["USD"]);
  });
});

describe("computeMetrics — edge cases", () => {
  it("empty input produces zeros and null win rate", () => {
    const m = computeMetrics([]);
    expect(m.openPipelineValue).toBe(0);
    expect(m.winRate).toBeNull();
    expect(m.marginByNiche).toEqual([]);
    expect(m.cashByMonth).toEqual([]);
  });

  it("won deal without won_at is excluded from cash timing but counted in totals", () => {
    const m = computeMetrics([
      deal({ id: "x", stage: "won", value: 100, gross_margin: 100 }),
    ]);
    expect(m.totalWonValue).toBe(100);
    expect(m.cashByMonth).toEqual([]);
  });

  it("missing gross_margin falls back to value − cost", () => {
    const m = computeMetrics([
      deal({ id: "y", stage: "won", value: 500, actual_delivery_cost: 200 }),
    ]);
    expect(m.totalWonMargin).toBe(300);
  });

  it("mixed currencies are surfaced", () => {
    const m = computeMetrics([
      deal({ id: "u", stage: "won", value: 10, currency: "USD" }),
      deal({ id: "z", stage: "won", value: 10, currency: "ZAR" }),
    ]);
    expect(m.currencies).toEqual(["USD", "ZAR"]);
  });
});
