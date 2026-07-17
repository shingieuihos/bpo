import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeMetrics, type ReportDeal } from "@/lib/reporting/metrics";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  qualifying: "Qualifying",
  negotiation: "Negotiation",
  contract_sent: "Contract sent",
  won: "Won",
  lost: "Lost",
};

/** Server-rendered horizontal bar — no chart library, no client JS. */
function Bar({ value, max, label, detail }: { value: number; max: number; label: string; detail: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">{detail}</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted">
        <div className="h-2.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-2xl font-semibold">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  let query = supabase
    .from("deals")
    .select(
      "id, stage, value, currency, estimated_delivery_cost, actual_delivery_cost, gross_margin, win_probability, created_at, won_at, opportunities (title, niches (name))",
    )
    .limit(1000);
  if (from) query = query.gte("created_at", new Date(from).toISOString());
  if (to) query = query.lte("created_at", new Date(`${to}T23:59:59`).toISOString());

  const [{ data: dealRows }, { data: ltv }] = await Promise.all([
    query,
    supabase
      .from("v_client_lifetime_value")
      .select("client_id, name, lifetime_value, won_deals")
      .order("lifetime_value", { ascending: false })
      .limit(8),
  ]);

  const deals: ReportDeal[] = (dealRows ?? []).map((d) => ({
    id: d.id,
    stage: d.stage,
    value: d.value != null ? Number(d.value) : null,
    currency: d.currency,
    estimated_delivery_cost:
      d.estimated_delivery_cost != null ? Number(d.estimated_delivery_cost) : null,
    actual_delivery_cost:
      d.actual_delivery_cost != null ? Number(d.actual_delivery_cost) : null,
    gross_margin: d.gross_margin != null ? Number(d.gross_margin) : null,
    win_probability: d.win_probability,
    created_at: d.created_at,
    won_at: d.won_at,
    title: d.opportunities?.title ?? null,
    nicheName: d.opportunities?.niches?.name ?? null,
  }));

  const m = computeMetrics(deals);
  const cur = m.currencies.length === 1 ? m.currencies[0] : "";
  const mixed = m.currencies.length > 1;
  const fmt = (n: number) => `${n.toLocaleString()}${cur ? ` ${cur}` : ""}`;
  const maxStage = Math.max(...m.pipelineByStage.map((s) => s.value), 1);
  const maxNiche = Math.max(...m.marginByNiche.map((n) => n.margin), 1);
  const maxCash = Math.max(...m.cashByMonth.map((c) => c.value), 1);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Revenue</h1>
          <p className="text-sm text-muted-foreground">
            Computed live from the pipeline — no separate data store.
            {mixed && " ⚠ Mixed currencies present; sums are naive."}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs font-medium">Deals created from</label>
          <Input id="from" name="from" type="date" defaultValue={from ?? ""} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs font-medium">to</label>
          <Input id="to" name="to" type="date" defaultValue={to ?? ""} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">Apply</Button>
        {(from || to) && (
          <Button variant="ghost" asChild>
            <Link href="/reports">Clear</Link>
          </Button>
        )}
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Open pipeline" value={fmt(m.openPipelineValue)} hint={`weighted ${fmt(m.weightedPipelineValue)}`} />
        <Tile
          label="Win rate"
          value={m.winRate != null ? `${Math.round(m.winRate * 100)}%` : "—"}
          hint={`${m.wonCount} won · ${m.lostCount} lost`}
        />
        <Tile label="Won revenue" value={fmt(m.totalWonValue)} hint={`delivery cost ${fmt(m.totalDeliveryCost)}`} />
        <Tile
          label="Gross margin (won)"
          value={fmt(m.totalWonMargin)}
          hint={
            m.totalWonValue > 0
              ? `${Math.round((m.totalWonMargin / m.totalWonValue) * 100)}% of revenue`
              : undefined
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline value by stage</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {m.pipelineByStage.map((s) => (
              <Bar
                key={s.stage}
                value={s.value}
                max={maxStage}
                label={STAGE_LABELS[s.stage]}
                detail={`${s.count} · ${fmt(s.value)}`}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gross margin by niche</CardTitle>
            <CardDescription>Won deals; actual costs where recorded.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {m.marginByNiche.length === 0 && (
              <p className="text-sm text-muted-foreground">No won deals yet.</p>
            )}
            {m.marginByNiche.map((n) => (
              <Bar
                key={n.niche}
                value={Math.max(n.margin, 0)}
                max={maxNiche}
                label={n.niche}
                detail={`${n.deals} deal${n.deals === 1 ? "" : "s"} · margin ${fmt(n.margin)}`}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cash timing</CardTitle>
            <CardDescription>Won value by month won.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {m.cashByMonth.length === 0 && (
              <p className="text-sm text-muted-foreground">No wins recorded yet.</p>
            )}
            {m.cashByMonth.map((c) => (
              <Bar key={c.month} value={c.value} max={maxCash} label={c.month} detail={fmt(c.value)} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top clients by lifetime value</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(ltv ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No clients yet.</p>
            )}
            {(ltv ?? []).map((c) => (
              <div key={c.client_id} className="flex items-center justify-between text-sm">
                <Link href={`/clients/${c.client_id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                <span className="text-muted-foreground">
                  {Number(c.lifetime_value ?? 0).toLocaleString()} · {c.won_deals} won
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gross margin per project</CardTitle>
          <CardDescription>Every won deal, best margin first.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">Project</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Delivery cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.marginByProject.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Win a deal to see project margins.
                  </TableCell>
                </TableRow>
              )}
              {m.marginByProject.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/deals/${p.id}`} className="font-medium hover:underline">
                      {p.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{p.value != null ? fmt(p.value) : "—"}</TableCell>
                  <TableCell className="text-right">{p.deliveryCost != null ? fmt(p.deliveryCost) : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {p.margin != null ? fmt(p.margin) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.margin != null && p.value ? (
                      <Badge variant={p.margin / p.value >= 0.45 ? "default" : "destructive"}>
                        {Math.round((p.margin / p.value) * 100)}%
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
