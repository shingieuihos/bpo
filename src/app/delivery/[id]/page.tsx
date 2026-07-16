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
import { parseTasks, totalTaskCost, allTasksDone } from "@/lib/delivery/tasks";
import { createClient } from "@/lib/supabase/server";

import {
  decompose,
  deliver,
  draftTaskAction,
  qaVerdict,
  saveTask,
  sendToQA,
} from "../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // decomposition + task drafting call Claude

export default async function DeliveryJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const [{ data: job }, { data: contractors }] = await Promise.all([
    supabase
      .from("delivery_jobs")
      .select(
        "id, brief, tasks, status, qa_status, qa_notes, deal_id, deals (id, value, currency, actual_delivery_cost, gross_margin, opportunities (title, niches (name, sop_ref)))",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("contractors").select("id, name, rate, currency").order("name"),
  ]);
  if (!job) notFound();

  const tasks = parseTasks(job.tasks);
  const niche = job.deals?.opportunities?.niches;
  const delivered = job.status === "delivered";
  const readyForQA = allTasksDone(tasks) && job.status === "in_progress";
  const costTotal = totalTaskCost(tasks);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {job.deals?.opportunities?.title ?? "Delivery job"}
            </h1>
            <Badge variant={delivered ? "default" : "secondary"}>{job.status}</Badge>
            <Badge
              variant={
                job.qa_status === "passed"
                  ? "default"
                  : job.qa_status === "rework"
                    ? "destructive"
                    : "outline"
              }
            >
              QA: {job.qa_status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {niche?.name ?? "No niche"}
            {niche?.sop_ref && ` · SOP: ${niche.sop_ref}`}
            {" · task costs "}
            {costTotal.toLocaleString()} · deal margin{" "}
            {job.deals?.gross_margin != null
              ? Number(job.deals.gross_margin).toLocaleString()
              : "—"}{" "}
            {job.deals?.currency}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/deals/${job.deal_id}`}>Deal</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/delivery">All jobs</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Brief</CardTitle>
            <CardDescription>
              {tasks.length === 0
                ? "Decompose it into routed tasks to start delivery."
                : `${tasks.length} tasks · ${tasks.filter((t) => t.status === "done").length} done`}
            </CardDescription>
          </div>
          {tasks.length === 0 && !delivered && (
            <form action={decompose}>
              <input type="hidden" name="job_id" value={job.id} />
              <Button type="submit">Decompose with AI</Button>
            </form>
          )}
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
            {job.brief}
          </p>
        </CardContent>
      </Card>

      {tasks.map((task, index) => (
        <Card key={task.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {index + 1}. {task.title}
            </CardTitle>
            <CardDescription>{task.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form action={saveTask} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="job_id" value={job.id} />
              <input type="hidden" name="task_id" value={task.id} />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Assignee</label>
                <select
                  name="assignee"
                  defaultValue={task.assignee_type === "ai" ? "ai" : task.assignee_ref ?? "ai"}
                  disabled={delivered}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="ai">AI (Claude first-draft)</option>
                  {(contractors ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.rate != null ? ` (${c.rate}/${c.currency}/h)` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Status</label>
                <select
                  name="status"
                  defaultValue={task.status}
                  disabled={delivered}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="todo">todo</option>
                  <option value="in_progress">in progress</option>
                  <option value="done">done</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">
                  Actual cost{task.estimated_hours != null ? ` (est ${task.estimated_hours}h)` : ""}
                </label>
                <Input
                  name="cost"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={task.cost ?? ""}
                  disabled={delivered}
                  className="w-32"
                />
              </div>
              {!delivered && (
                <Button type="submit" variant="secondary" size="sm">
                  Save
                </Button>
              )}
            </form>

            {task.assignee_type === "ai" && !delivered && (
              <form action={draftTaskAction}>
                <input type="hidden" name="job_id" value={job.id} />
                <input type="hidden" name="task_id" value={task.id} />
                <Button type="submit" variant="outline" size="sm">
                  {task.ai_draft ? "Regenerate draft" : "Generate first draft"}
                </Button>
              </form>
            )}

            {task.ai_draft && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                {task.ai_draft}
              </pre>
            )}
          </CardContent>
        </Card>
      ))}

      {!delivered && tasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">QA gate</CardTitle>
            <CardDescription>
              Delivery is blocked until QA passes — no exceptions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {job.status === "in_progress" && (
              <form action={sendToQA}>
                <input type="hidden" name="job_id" value={job.id} />
                <Button type="submit" disabled={!readyForQA}>
                  Submit for QA
                </Button>
                {!readyForQA && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    All tasks must be done first.
                  </p>
                )}
              </form>
            )}

            {job.status === "qa" && job.qa_status !== "passed" && (
              <form action={qaVerdict} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="job_id" value={job.id} />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">QA notes</label>
                  <Input name="notes" defaultValue={job.qa_notes ?? ""} className="w-80" />
                </div>
                <Button type="submit" name="verdict" value="passed">
                  Pass QA
                </Button>
                <Button type="submit" name="verdict" value="rework" variant="destructive">
                  Needs rework
                </Button>
              </form>
            )}

            {job.qa_status === "rework" && job.qa_notes && (
              <p className="text-sm text-destructive">Rework: {job.qa_notes}</p>
            )}

            {job.status === "qa" && job.qa_status === "passed" && (
              <form action={deliver}>
                <input type="hidden" name="job_id" value={job.id} />
                <Button type="submit">Mark delivered ✓</Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {delivered && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Delivered. Task costs ({costTotal.toLocaleString()}) are rolled into
            the deal&apos;s actual delivery cost — gross margin reflects reality.
          </CardContent>
        </Card>
      )}
    </main>
  );
}
