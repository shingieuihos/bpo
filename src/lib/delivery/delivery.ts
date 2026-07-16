import "server-only";

import { randomUUID } from "node:crypto";

import { decomposeBrief, draftTask } from "@/lib/delivery/ai";
import {
  allTasksDone,
  parseTasks,
  serializeTasks,
  totalTaskCost,
  type DeliveryTask,
} from "@/lib/delivery/tasks";
import { createAdminClient } from "@/lib/supabase/admin";

/** Create a delivery job from a WON deal (one active job per deal). */
export async function createDeliveryJob(params: {
  dealId: string;
  orgId: string;
  actorId: string;
  brief: string;
}): Promise<{ jobId: string }> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  if (!params.brief.trim()) throw new Error("a delivery job needs a brief");
  const admin = createAdminClient();

  const { data: deal, error } = await admin
    .from("deals")
    .select("id, stage")
    .eq("id", params.dealId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !deal) throw new Error("deal not found");
  if (deal.stage !== "won") throw new Error("delivery jobs start from won deals");

  const { data: existing } = await admin
    .from("delivery_jobs")
    .select("id")
    .eq("deal_id", deal.id)
    .neq("status", "cancelled")
    .limit(1);
  if (existing && existing.length > 0) return { jobId: existing[0].id };

  const { data: job, error: insertError } = await admin
    .from("delivery_jobs")
    .insert({
      org_id: params.orgId,
      deal_id: deal.id,
      brief: params.brief.trim().slice(0, 20_000),
      tasks: [],
      status: "draft",
      qa_status: "pending",
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`delivery job insert failed: ${insertError.message}`);

  await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.actorId,
    action: "delivery_job.created",
    entity_type: "delivery_job",
    entity_id: job.id,
    metadata: { deal_id: deal.id },
  });

  return { jobId: job.id };
}

/** Claude decomposes the brief into routed tasks; job moves to in_progress. */
export async function decomposeJob(params: {
  jobId: string;
  orgId: string;
  actorId: string;
}): Promise<{ taskCount: number }> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  const admin = createAdminClient();

  const { data: job, error } = await admin
    .from("delivery_jobs")
    .select(
      "id, brief, status, deals (opportunities (niches (name, sop_ref)))",
    )
    .eq("id", params.jobId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !job) throw new Error("delivery job not found");
  if (!job.brief) throw new Error("job has no brief to decompose");
  if (job.status === "delivered") throw new Error("job is already delivered");

  const niche = job.deals?.opportunities?.niches ?? null;
  const decomposed = await decomposeBrief({
    brief: job.brief,
    nicheName: niche?.name ?? null,
    sopRef: niche?.sop_ref ?? null,
  });

  const tasks: DeliveryTask[] = decomposed.map((t) => ({
    id: randomUUID(),
    title: t.title,
    description: t.description,
    assignee_type: t.assignee_type,
    assignee_ref: null,
    status: "todo",
    estimated_hours: t.estimated_hours,
    ai_draft: null,
    cost: null,
  }));

  const { error: updateError } = await admin
    .from("delivery_jobs")
    .update({ tasks: serializeTasks(tasks), status: "in_progress" })
    .eq("id", job.id);
  if (updateError) throw new Error(`task write failed: ${updateError.message}`);

  return { taskCount: tasks.length };
}

/** Update one task (assignee, status, cost) and roll costs up to the deal. */
export async function updateTask(params: {
  jobId: string;
  orgId: string;
  taskId: string;
  patch: Partial<
    Pick<DeliveryTask, "assignee_type" | "assignee_ref" | "status" | "cost">
  >;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: job, error } = await admin
    .from("delivery_jobs")
    .select("id, tasks, status, deal_id")
    .eq("id", params.jobId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !job) throw new Error("delivery job not found");
  if (job.status === "delivered") throw new Error("delivered jobs are immutable");

  const tasks = parseTasks(job.tasks);
  const task = tasks.find((t) => t.id === params.taskId);
  if (!task) throw new Error("task not found");
  Object.assign(task, params.patch);

  const { error: updateError } = await admin
    .from("delivery_jobs")
    .update({ tasks: serializeTasks(tasks) })
    .eq("id", job.id);
  if (updateError) throw new Error(`task update failed: ${updateError.message}`);

  await syncDealCost(params.orgId, job.deal_id);
}

/** AI-assisted first draft for one ai-routed task. */
export async function generateTaskDraft(params: {
  jobId: string;
  orgId: string;
  taskId: string;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: job, error } = await admin
    .from("delivery_jobs")
    .select("id, brief, tasks, status, deals (opportunities (niches (name)))")
    .eq("id", params.jobId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !job) throw new Error("delivery job not found");
  if (job.status === "delivered") throw new Error("delivered jobs are immutable");

  const tasks = parseTasks(job.tasks);
  const task = tasks.find((t) => t.id === params.taskId);
  if (!task) throw new Error("task not found");
  if (task.assignee_type !== "ai") {
    throw new Error("only ai-routed tasks get AI first drafts");
  }

  task.ai_draft = await draftTask({
    brief: job.brief ?? "",
    taskTitle: task.title,
    taskDescription: task.description,
    nicheName: job.deals?.opportunities?.niches?.name ?? null,
  });
  if (task.status === "todo") task.status = "in_progress";

  const { error: updateError } = await admin
    .from("delivery_jobs")
    .update({ tasks: serializeTasks(tasks) })
    .eq("id", job.id);
  if (updateError) throw new Error(`draft write failed: ${updateError.message}`);
}

/** All tasks done → job enters QA. */
export async function submitForQA(params: {
  jobId: string;
  orgId: string;
  actorId: string;
}): Promise<void> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  const admin = createAdminClient();

  const { data: job, error } = await admin
    .from("delivery_jobs")
    .select("id, tasks, status")
    .eq("id", params.jobId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !job) throw new Error("delivery job not found");
  if (!allTasksDone(parseTasks(job.tasks))) {
    throw new Error("all tasks must be done before QA");
  }

  const { error: updateError } = await admin
    .from("delivery_jobs")
    .update({ status: "qa", qa_status: "pending" })
    .eq("id", job.id);
  if (updateError) throw new Error(`QA submit failed: ${updateError.message}`);
}

/** QA verdict: pass, or rework (with notes) which reopens the job. */
export async function recordQA(params: {
  jobId: string;
  orgId: string;
  actorId: string;
  verdict: "passed" | "rework";
  notes?: string | null;
}): Promise<void> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  const admin = createAdminClient();

  const { data: job, error } = await admin
    .from("delivery_jobs")
    .select("id, status")
    .eq("id", params.jobId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !job) throw new Error("delivery job not found");
  if (job.status !== "qa") throw new Error("job is not in QA");

  const { error: updateError } = await admin
    .from("delivery_jobs")
    .update({
      qa_status: params.verdict,
      qa_notes: params.notes?.trim().slice(0, 4000) || null,
      status: params.verdict === "rework" ? "in_progress" : "qa",
    })
    .eq("id", job.id);
  if (updateError) throw new Error(`QA verdict failed: ${updateError.message}`);

  await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.actorId,
    action: `delivery_job.qa_${params.verdict}`,
    entity_type: "delivery_job",
    entity_id: job.id,
    metadata: { notes: params.notes?.slice(0, 500) ?? null },
  });
}

/**
 * ── THE QA GATE ─────────────────────────────────────────────────────────────
 * A job can be marked delivered ONLY when QA has passed. This is the single
 * path to status 'delivered', and it refuses anything unreviewed.
 */
export async function markDelivered(params: {
  jobId: string;
  orgId: string;
  actorId: string;
}): Promise<void> {
  if (!params.actorId) throw new Error("requires a signed-in user");
  const admin = createAdminClient();

  const { data: job, error } = await admin
    .from("delivery_jobs")
    .select("id, status, qa_status, deal_id")
    .eq("id", params.jobId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (error || !job) throw new Error("delivery job not found");
  if (job.qa_status !== "passed") {
    throw new Error("QA gate: the job cannot be delivered until QA has passed");
  }

  const { error: updateError } = await admin
    .from("delivery_jobs")
    .update({ status: "delivered" })
    .eq("id", job.id);
  if (updateError) throw new Error(`delivery failed: ${updateError.message}`);

  await syncDealCost(params.orgId, job.deal_id);

  await admin.from("audit_events").insert({
    org_id: params.orgId,
    actor: params.actorId,
    action: "delivery_job.delivered",
    entity_type: "delivery_job",
    entity_id: job.id,
    metadata: { deal_id: job.deal_id },
  });
}

/**
 * Roll ALL of a deal's delivery task costs into deals.actual_delivery_cost —
 * the DB then regenerates gross_margin, so margin reflects reality.
 */
async function syncDealCost(orgId: string, dealId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("delivery_jobs")
    .select("tasks")
    .eq("org_id", orgId)
    .eq("deal_id", dealId)
    .neq("status", "cancelled");

  const total = (jobs ?? []).reduce(
    (sum, j) => sum + totalTaskCost(parseTasks(j.tasks)),
    0,
  );
  await admin
    .from("deals")
    .update({ actual_delivery_cost: total > 0 ? total : null })
    .eq("id", dealId);
}
