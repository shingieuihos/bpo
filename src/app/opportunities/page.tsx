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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { compositeScore, parseWeights } from "@/lib/scoring/composite";
import { createClient } from "@/lib/supabase/server";

import { runScoringNow, saveWeights } from "./actions";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  marketplace_api: "Marketplace",
  alert_email: "Alert email",
  owned_inbound: "Inbound",
  outbound: "Outbound",
};

export default async function OpportunitiesPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, organizations (settings)")
    .limit(1)
    .maybeSingle();
  if (!membership) redirect("/dashboard");

  const weights = parseWeights(membership.organizations?.settings);

  const [{ data: opportunities }, { count: pendingJobs }] = await Promise.all([
    supabase
      .from("opportunities")
      .select(
        "id, title, source, status, budget, currency, fit_score, margin_potential_score, urgency_score, effort_score, score_rationale, niches (name)",
      )
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "score_opportunity")
      .in("status", ["pending", "processing"]),
  ]);

  const ranked = (opportunities ?? [])
    .map((o) => ({ ...o, composite: compositeScore(o, weights) }))
    .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Opportunity queue</h1>
          <p className="text-sm text-muted-foreground">
            Ranked by composite score — reweight below to change the ordering.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Scoring</CardTitle>
            <CardDescription>
              {pendingJobs
                ? `${pendingJobs} opportunit${pendingJobs === 1 ? "y" : "ies"} waiting for AI scoring.`
                : "All opportunities scored."}
            </CardDescription>
          </div>
          <form action={runScoringNow}>
            <Button type="submit" disabled={!pendingJobs}>
              Run scoring now
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          <form action={saveWeights} className="flex flex-wrap items-end gap-4">
            {(
              [
                ["fit", "Fit", weights.fit],
                ["margin", "Margin", weights.margin],
                ["urgency", "Urgency", weights.urgency],
                ["effort", "Low effort", weights.effort],
              ] as const
            ).map(([name, label, value]) => (
              <div key={name} className="flex flex-col gap-1.5">
                <Label htmlFor={`w-${name}`}>{label}</Label>
                <Input
                  id={`w-${name}`}
                  name={name}
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={value}
                  className="w-24"
                />
              </div>
            ))}
            <Button type="submit" variant="secondary">
              Save weights
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36%]">Opportunity</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-center">F / M / U / E</TableHead>
                <TableHead className="text-right">Composite</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No opportunities yet — ingest some via the API endpoints or
                    run <code>npm run seed</code>.
                  </TableCell>
                </TableRow>
              )}
              {ranked.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.title}</div>
                    {o.score_rationale && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {o.score_rationale}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {SOURCE_LABELS[o.source] ?? o.source}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {o.niches?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {o.budget != null
                      ? `${Number(o.budget).toLocaleString()} ${o.currency}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs">
                    {o.fit_score != null
                      ? `${o.fit_score} / ${o.margin_potential_score} / ${o.urgency_score} / ${o.effort_score}`
                      : "pending"}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {o.composite ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={o.status === "scored" ? "default" : "secondary"}>
                      {o.status}
                    </Badge>
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
