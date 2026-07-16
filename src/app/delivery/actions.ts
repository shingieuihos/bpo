"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createDeliveryJob,
  decomposeJob,
  generateTaskDraft,
  markDelivered,
  recordQA,
  submitForQA,
  updateTask,
} from "@/lib/delivery/delivery";
import { createClient } from "@/lib/supabase/server";

async function requireActor(): Promise<{ orgId: string; userId: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) throw new Error("not signed in");
  const { data: membership, error: memberError } = await supabase
    .from("org_members")
    .select("org_id")
    .limit(1)
    .maybeSingle();
  if (memberError || !membership) throw new Error("no org membership");
  return { orgId: membership.org_id, userId: String(data.claims.sub) };
}

export async function createJob(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const dealId = String(formData.get("deal_id") ?? "");
  const brief = String(formData.get("brief") ?? "");
  if (!dealId) throw new Error("missing deal");
  const { jobId } = await createDeliveryJob({ dealId, orgId, actorId: userId, brief });
  redirect(`/delivery/${jobId}`);
}

export async function decompose(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const jobId = String(formData.get("job_id") ?? "");
  if (!jobId) throw new Error("missing job");
  await decomposeJob({ jobId, orgId, actorId: userId });
  revalidatePath(`/delivery/${jobId}`);
}

export async function saveTask(formData: FormData): Promise<void> {
  const { orgId } = await requireActor();
  const jobId = String(formData.get("job_id") ?? "");
  const taskId = String(formData.get("task_id") ?? "");
  if (!jobId || !taskId) throw new Error("missing ids");

  const assignee = String(formData.get("assignee") ?? "");
  const status = String(formData.get("status") ?? "");
  const costRaw = String(formData.get("cost") ?? "").trim();
  const cost = costRaw ? Number.parseFloat(costRaw) : null;

  await updateTask({
    jobId,
    orgId,
    taskId,
    patch: {
      assignee_type: assignee === "" || assignee === "ai" ? "ai" : "contractor",
      assignee_ref: assignee && assignee !== "ai" ? assignee : null,
      status:
        status === "in_progress" || status === "done" ? status : "todo",
      cost: cost != null && Number.isFinite(cost) && cost >= 0 ? cost : null,
    },
  });
  revalidatePath(`/delivery/${jobId}`);
}

export async function draftTaskAction(formData: FormData): Promise<void> {
  const { orgId } = await requireActor();
  const jobId = String(formData.get("job_id") ?? "");
  const taskId = String(formData.get("task_id") ?? "");
  if (!jobId || !taskId) throw new Error("missing ids");
  await generateTaskDraft({ jobId, orgId, taskId });
  revalidatePath(`/delivery/${jobId}`);
}

export async function sendToQA(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const jobId = String(formData.get("job_id") ?? "");
  await submitForQA({ jobId, orgId, actorId: userId });
  revalidatePath(`/delivery/${jobId}`);
}

export async function qaVerdict(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const jobId = String(formData.get("job_id") ?? "");
  const verdict = String(formData.get("verdict") ?? "");
  if (verdict !== "passed" && verdict !== "rework") throw new Error("invalid verdict");
  await recordQA({
    jobId,
    orgId,
    actorId: userId,
    verdict,
    notes: String(formData.get("notes") ?? ""),
  });
  revalidatePath(`/delivery/${jobId}`);
}

export async function deliver(formData: FormData): Promise<void> {
  const { orgId, userId } = await requireActor();
  const jobId = String(formData.get("job_id") ?? "");
  await markDelivered({ jobId, orgId, actorId: userId });
  revalidatePath(`/delivery/${jobId}`);
  revalidatePath("/pipeline");
}

export async function addContractor(formData: FormData): Promise<void> {
  const { orgId } = await requireActor();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("contractor needs a name");
  const rateRaw = String(formData.get("rate") ?? "").trim();
  const rate = rateRaw ? Number.parseFloat(rateRaw) : null;
  const skills = String(formData.get("skills") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Authed client → RLS org scope.
  const supabase = await createClient();
  const { error } = await supabase.from("contractors").insert({
    org_id: orgId,
    name,
    skills,
    rate: rate != null && Number.isFinite(rate) ? rate : null,
  });
  if (error) throw new Error("contractor insert failed");
  revalidatePath("/delivery");
}
