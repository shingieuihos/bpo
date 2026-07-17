/**
 * Revenue metrics — pure functions over deal/client rows, so every number on
 * the dashboard is reproducible by hand in the unit tests. No separate data
 * store: the page feeds this straight from the live tables.
 */

export interface ReportDeal {
  id: string;
  stage: "qualifying" | "negotiation" | "contract_sent" | "won" | "lost";
  value: number | null;
  currency: string;
  estimated_delivery_cost: number | null;
  actual_delivery_cost: number | null;
  gross_margin: number | null;
  win_probability: number | null;
  created_at: string;
  won_at: string | null;
  title: string | null;
  nicheName: string | null;
}

export interface StageMetric {
  stage: ReportDeal["stage"];
  count: number;
  value: number;
}

export interface NicheMargin {
  niche: string;
  wonValue: number;
  deliveryCost: number;
  margin: number;
  deals: number;
}

export interface ProjectMargin {
  id: string;
  title: string;
  value: number | null;
  deliveryCost: number | null;
  margin: number | null;
}

export interface MonthCash {
  month: string; // YYYY-MM
  value: number;
}

export interface ReportMetrics {
  openPipelineValue: number;
  weightedPipelineValue: number;
  pipelineByStage: StageMetric[];
  wonCount: number;
  lostCount: number;
  winRate: number | null; // 0..1 over closed deals
  totalWonValue: number;
  totalDeliveryCost: number; // won deals: actual, falling back to estimate
  totalWonMargin: number;
  marginByNiche: NicheMargin[];
  marginByProject: ProjectMargin[];
  cashByMonth: MonthCash[]; // ascending months, won deals by won_at
  currencies: string[]; // >1 → sums are mixed-currency, surface a caveat
}

const OPEN_STAGES = ["qualifying", "negotiation", "contract_sent"] as const;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Won-deal delivery cost: actuals when known, else the estimate, else 0. */
export function deliveryCostOf(d: ReportDeal): number {
  return d.actual_delivery_cost ?? d.estimated_delivery_cost ?? 0;
}

/** Per-deal margin: DB-computed when present, else value − cost, else null. */
export function marginOf(d: ReportDeal): number | null {
  if (d.gross_margin != null) return d.gross_margin;
  if (d.value == null) return null;
  return d.value - deliveryCostOf(d);
}

export function computeMetrics(deals: ReportDeal[]): ReportMetrics {
  const open = deals.filter((d) =>
    (OPEN_STAGES as readonly string[]).includes(d.stage),
  );
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");

  const pipelineByStage: StageMetric[] = (
    ["qualifying", "negotiation", "contract_sent", "won", "lost"] as const
  ).map((stage) => {
    const inStage = deals.filter((d) => d.stage === stage);
    return {
      stage,
      count: inStage.length,
      value: round2(inStage.reduce((s, d) => s + (d.value ?? 0), 0)),
    };
  });

  const nicheMap = new Map<string, NicheMargin>();
  for (const d of won) {
    const key = d.nicheName ?? "No niche";
    const entry =
      nicheMap.get(key) ??
      ({ niche: key, wonValue: 0, deliveryCost: 0, margin: 0, deals: 0 } as NicheMargin);
    entry.wonValue = round2(entry.wonValue + (d.value ?? 0));
    entry.deliveryCost = round2(entry.deliveryCost + deliveryCostOf(d));
    entry.margin = round2(entry.margin + (marginOf(d) ?? 0));
    entry.deals += 1;
    nicheMap.set(key, entry);
  }

  const cashMap = new Map<string, number>();
  for (const d of won) {
    if (!d.won_at) continue;
    const month = d.won_at.slice(0, 7);
    cashMap.set(month, round2((cashMap.get(month) ?? 0) + (d.value ?? 0)));
  }

  const closed = won.length + lost.length;

  return {
    openPipelineValue: round2(open.reduce((s, d) => s + (d.value ?? 0), 0)),
    weightedPipelineValue: round2(
      open.reduce(
        (s, d) => s + ((d.value ?? 0) * (d.win_probability ?? 50)) / 100,
        0,
      ),
    ),
    pipelineByStage,
    wonCount: won.length,
    lostCount: lost.length,
    winRate: closed > 0 ? won.length / closed : null,
    totalWonValue: round2(won.reduce((s, d) => s + (d.value ?? 0), 0)),
    totalDeliveryCost: round2(won.reduce((s, d) => s + deliveryCostOf(d), 0)),
    totalWonMargin: round2(won.reduce((s, d) => s + (marginOf(d) ?? 0), 0)),
    marginByNiche: [...nicheMap.values()].sort((a, b) => b.margin - a.margin),
    marginByProject: won
      .map((d) => ({
        id: d.id,
        title: d.title ?? "Untitled deal",
        value: d.value,
        deliveryCost: deliveryCostOf(d),
        margin: marginOf(d),
      }))
      .sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity)),
    cashByMonth: [...cashMap.entries()]
      .map(([month, value]) => ({ month, value }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    currencies: [...new Set(deals.map((d) => d.currency))].sort(),
  };
}
