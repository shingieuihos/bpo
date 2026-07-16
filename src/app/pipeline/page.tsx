import Link from "next/link";
import { redirect } from "next/navigation";

import { StageSelect } from "@/components/stage-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { changeStage } from "./actions";

export const dynamic = "force-dynamic";

const BOARD_STAGES = [
  { key: "qualifying", label: "Qualifying" },
  { key: "negotiation", label: "Negotiation" },
  { key: "contract_sent", label: "Contract sent" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;

export default async function PipelinePage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const { data: deals } = await supabase
    .from("deals")
    .select(
      "id, stage, value, currency, win_probability, next_action_at, next_action_note, gross_margin, opportunities (title), clients (id, name)",
    )
    .order("created_at", { ascending: false })
    .limit(300);

  const all = deals ?? [];
  const nextActions = all
    .filter((d) => d.next_action_at && d.stage !== "won" && d.stage !== "lost")
    .sort(
      (a, b) =>
        new Date(a.next_action_at!).getTime() - new Date(b.next_action_at!).getTime(),
    )
    .slice(0, 8);

  const fmt = (v: number | null, cur: string) =>
    v != null ? `${Number(v).toLocaleString()} ${cur}` : "—";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Deals from sent proposals — walk them to won and a client record.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/opportunities">Opportunities</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/clients">Clients</Link>
          </Button>
        </div>
      </div>

      {nextActions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {nextActions.map((d) => {
              const overdue = new Date(d.next_action_at!) < new Date();
              return (
                <div key={d.id} className="flex items-center justify-between gap-4 text-sm">
                  <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                    {d.opportunities?.title ?? "Deal"}
                  </Link>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {d.next_action_note ?? "follow up"}
                    <Badge variant={overdue ? "destructive" : "outline"}>
                      {new Date(d.next_action_at!).toLocaleDateString()}
                    </Badge>
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {BOARD_STAGES.map((stage) => {
          const items = all.filter((d) => d.stage === stage.key);
          const total = items.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
          return (
            <div key={stage.key} className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold">{stage.label}</h2>
                <span className="text-xs text-muted-foreground">
                  {items.length} · {total.toLocaleString()}
                </span>
              </div>
              {items.map((d) => (
                <Card key={d.id} className="gap-2 py-4">
                  <CardContent className="flex flex-col gap-2 px-4">
                    <Link
                      href={`/deals/${d.id}`}
                      className="line-clamp-2 text-sm font-medium hover:underline"
                    >
                      {d.opportunities?.title ?? "Deal"}
                    </Link>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{fmt(d.value, d.currency)}</span>
                      {d.win_probability != null && <span>{d.win_probability}%</span>}
                    </div>
                    {d.clients && (
                      <Link
                        href={`/clients/${d.clients.id}`}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        {d.clients.name}
                      </Link>
                    )}
                    <StageSelect dealId={d.id} stage={d.stage} action={changeStage} />
                  </CardContent>
                </Card>
              ))}
              {items.length === 0 && (
                <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  empty
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
