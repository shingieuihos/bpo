import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
import { createClient } from "@/lib/supabase/server";

import { createJob } from "../../delivery/actions";
import { updateDealDetails, winDeal } from "../../pipeline/actions";

export const dynamic = "force-dynamic";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const [{ data: deal }, { data: clients }, { data: jobs }] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, stage, value, currency, estimated_delivery_cost, actual_delivery_cost, gross_margin, win_probability, next_action_at, next_action_note, opportunities (id, title, source, description), clients (id, name)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("clients").select("id, name").order("name").limit(200),
    supabase
      .from("delivery_jobs")
      .select("id, status, qa_status")
      .eq("deal_id", id)
      .neq("status", "cancelled")
      .limit(1),
  ]);
  if (!deal) notFound();
  const deliveryJob = jobs?.[0] ?? null;

  const isClosed = deal.stage === "won" || deal.stage === "lost";
  const dateValue = deal.next_action_at
    ? new Date(deal.next_action_at).toISOString().slice(0, 10)
    : "";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {deal.opportunities?.title ?? "Deal"}
            </h1>
            <Badge variant={deal.stage === "won" ? "default" : "secondary"}>
              {deal.stage}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {deal.clients ? (
              <>
                Client:{" "}
                <Link href={`/clients/${deal.clients.id}`} className="hover:underline">
                  {deal.clients.name}
                </Link>
              </>
            ) : (
              "No client yet — attached when the deal is won."
            )}
            {deal.gross_margin != null &&
              ` · gross margin ${Number(deal.gross_margin).toLocaleString()} ${deal.currency}`}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/pipeline">Pipeline</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deal economics & next action</CardTitle>
          <CardDescription>
            Gross margin = value − delivery cost (actuals from Phase 6 override the estimate).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateDealDetails} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="deal_id" value={deal.id} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="value">Value ({deal.currency})</Label>
              <Input id="value" name="value" type="number" step="0.01" defaultValue={deal.value ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="estimated_delivery_cost">Estimated delivery cost</Label>
              <Input
                id="estimated_delivery_cost"
                name="estimated_delivery_cost"
                type="number"
                step="0.01"
                defaultValue={deal.estimated_delivery_cost ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="win_probability">Win probability (%)</Label>
              <Input
                id="win_probability"
                name="win_probability"
                type="number"
                min={0}
                max={100}
                defaultValue={deal.win_probability ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="next_action_at">Next action date</Label>
              <Input id="next_action_at" name="next_action_at" type="date" defaultValue={dateValue} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="next_action_note">Next action note</Label>
              <Input
                id="next_action_note"
                name="next_action_note"
                defaultValue={deal.next_action_note ?? ""}
                placeholder="e.g. follow up on contract redlines"
              />
            </div>
            <Button type="submit" variant="secondary" className="w-fit">
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      {deal.stage === "won" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivery</CardTitle>
            <CardDescription>
              {deliveryJob
                ? "This deal has a delivery job in flight."
                : "Spawn the delivery job — AI decomposes the brief into routed tasks."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {deliveryJob ? (
              <Button asChild>
                <Link href={`/delivery/${deliveryJob.id}`}>
                  Open delivery job ({deliveryJob.status}, QA {deliveryJob.qa_status})
                </Link>
              </Button>
            ) : (
              <form action={createJob} className="flex flex-col gap-3">
                <input type="hidden" name="deal_id" value={deal.id} />
                <Label htmlFor="brief">Intake brief</Label>
                <textarea
                  id="brief"
                  name="brief"
                  rows={5}
                  defaultValue={deal.opportunities?.description ?? ""}
                  placeholder="What exactly are we delivering, for whom, by when, and what does done look like?"
                  className="w-full resize-y rounded-md border bg-background p-3 text-sm"
                />
                <Button type="submit" className="w-fit">
                  Create delivery job
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {!isClosed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mark won</CardTitle>
            <CardDescription>
              A won deal needs a client record — pick an existing client or create one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={winDeal} className="flex flex-wrap items-end gap-4">
              <input type="hidden" name="deal_id" value={deal.id} />
              {(clients ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="client_id">Existing client</Label>
                  <select
                    id="client_id"
                    name="client_id"
                    defaultValue=""
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="">— none —</option>
                    {(clients ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new_client_name">…or new client name</Label>
                <Input id="new_client_name" name="new_client_name" placeholder="Acme Ltd" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new_client_email">Contact email (optional)</Label>
                <Input id="new_client_email" name="new_client_email" type="email" />
              </div>
              <Button type="submit">Mark won 🎉</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
