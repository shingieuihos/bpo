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
import { createClient } from "@/lib/supabase/server";

import { createDeal } from "../../pipeline/actions";
import { approveProposal, saveFinal, setOutcome } from "../actions";

export const dynamic = "force-dynamic";

const OUTCOME_OPTIONS = [
  "pending",
  "reply",
  "shortlisted",
  "won",
  "lost",
  "no_response",
] as const;

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const { data: proposal } = await supabase
    .from("proposals")
    .select(
      "id, draft, final, status, outcome, sent_at, created_at, opportunities (id, title, budget, currency, niches (name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!proposal) notFound();

  const isSent = proposal.status === "sent";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {proposal.opportunities?.title ?? "Proposal"}
            </h1>
            <Badge variant={isSent ? "default" : "secondary"}>{proposal.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {proposal.opportunities?.niches?.name ?? "No niche"} ·{" "}
            {proposal.opportunities?.budget != null
              ? `${Number(proposal.opportunities.budget).toLocaleString()} ${proposal.opportunities.currency}`
              : "no budget stated"}
            {proposal.sent_at &&
              ` · marked sent ${new Date(proposal.sent_at).toLocaleString()}`}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/proposals">All proposals</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI draft</CardTitle>
            <CardDescription>
              Grounded in your assets — the raw model output, never sent as-is.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
              {proposal.draft ?? "(no draft)"}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Final (yours)</CardTitle>
            <CardDescription>
              {isSent
                ? "Sent proposals are immutable."
                : "Edit into the version you will actually send."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form action={saveFinal} className="flex flex-col gap-3">
              <input type="hidden" name="proposal_id" value={proposal.id} />
              <textarea
                name="final"
                defaultValue={proposal.final ?? proposal.draft ?? ""}
                readOnly={isSent}
                rows={18}
                className="w-full resize-y rounded-md border bg-background p-3 font-mono text-sm"
              />
              {!isSent && (
                <Button type="submit" variant="secondary" className="self-start">
                  Save final
                </Button>
              )}
            </form>

            {!isSent && (
              <form action={approveProposal} className="border-t pt-4">
                <input type="hidden" name="proposal_id" value={proposal.id} />
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-muted-foreground">
                    You are confirming that <strong>you</strong> have sent (or will
                    now send) this final text yourself. ForgeOS records the
                    approval — it never submits anything anywhere.
                  </p>
                  <Button type="submit" disabled={!proposal.final?.trim()}>
                    Approve &amp; mark sent
                  </Button>
                </div>
                {!proposal.final?.trim() && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Save a final version first — the gate refuses empty finals.
                  </p>
                )}
              </form>
            )}

            {isSent && (
              <form action={createDeal} className="border-t pt-4">
                <input type="hidden" name="proposal_id" value={proposal.id} />
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-muted-foreground">
                    Track this in the pipeline — value defaults from the
                    opportunity budget.
                  </p>
                  <Button type="submit" variant="secondary">
                    Create deal →
                  </Button>
                </div>
              </form>
            )}

            {isSent && (
              <form action={setOutcome} className="flex items-end gap-3 border-t pt-4">
                <input type="hidden" name="proposal_id" value={proposal.id} />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="outcome" className="text-sm font-medium">
                    Outcome
                  </label>
                  <select
                    id="outcome"
                    name="outcome"
                    defaultValue={proposal.outcome}
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    {OUTCOME_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" variant="secondary">
                  Record outcome
                </Button>
                <p className="text-xs text-muted-foreground">
                  “Won” also files the final text into the RAG corpus.
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
