/**
 * Task model for delivery_jobs.tasks (jsonb) — pure helpers, unit-tested.
 * Every read goes through parseTasks() so malformed JSON can never crash a
 * page or worker; every write goes through serializeTasks().
 */
import type { Json } from "@/lib/database.types";

export interface DeliveryTask {
  id: string;
  title: string;
  description: string;
  assignee_type: "ai" | "contractor";
  /** contractors.id when assignee_type = contractor. */
  assignee_ref: string | null;
  status: "todo" | "in_progress" | "done";
  estimated_hours: number | null;
  /** AI-assisted first draft (assignee_type = ai). */
  ai_draft: string | null;
  /** Actual cost of this task — rolls up to deals.actual_delivery_cost. */
  cost: number | null;
}

export function parseTasks(raw: unknown): DeliveryTask[] {
  if (!Array.isArray(raw)) return [];
  const tasks: DeliveryTask[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.title !== "string") continue;
    tasks.push({
      id: t.id,
      title: t.title.slice(0, 300),
      description: typeof t.description === "string" ? t.description.slice(0, 4000) : "",
      assignee_type: t.assignee_type === "contractor" ? "contractor" : "ai",
      assignee_ref: typeof t.assignee_ref === "string" ? t.assignee_ref : null,
      status:
        t.status === "in_progress" || t.status === "done" ? t.status : "todo",
      estimated_hours:
        typeof t.estimated_hours === "number" && Number.isFinite(t.estimated_hours)
          ? t.estimated_hours
          : null,
      ai_draft: typeof t.ai_draft === "string" ? t.ai_draft : null,
      cost:
        typeof t.cost === "number" && Number.isFinite(t.cost) && t.cost >= 0
          ? t.cost
          : null,
    });
  }
  return tasks;
}

export function serializeTasks(tasks: DeliveryTask[]): Json {
  // Fresh object literals satisfy the generated Json type's index signature.
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    assignee_type: t.assignee_type,
    assignee_ref: t.assignee_ref,
    status: t.status,
    estimated_hours: t.estimated_hours,
    ai_draft: t.ai_draft,
    cost: t.cost,
  }));
}

export function totalTaskCost(tasks: DeliveryTask[]): number {
  return Math.round(tasks.reduce((sum, t) => sum + (t.cost ?? 0), 0) * 100) / 100;
}

export function allTasksDone(tasks: DeliveryTask[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.status === "done");
}

/** Strict validation of Claude's decomposition payload (structured output). */
export interface DecomposedTask {
  title: string;
  description: string;
  assignee_type: "ai" | "contractor";
  estimated_hours: number;
}

export function validateDecomposition(raw: unknown): DecomposedTask[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const tasks = (raw as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > 12) return null;
  const out: DecomposedTask[] = [];
  for (const item of tasks) {
    if (typeof item !== "object" || item === null) return null;
    const t = item as Record<string, unknown>;
    if (
      typeof t.title !== "string" ||
      !t.title.trim() ||
      typeof t.description !== "string" ||
      (t.assignee_type !== "ai" && t.assignee_type !== "contractor") ||
      typeof t.estimated_hours !== "number" ||
      !Number.isFinite(t.estimated_hours) ||
      t.estimated_hours < 0 ||
      t.estimated_hours > 1000
    ) {
      return null;
    }
    out.push({
      title: t.title.trim().slice(0, 300),
      description: t.description.trim().slice(0, 4000),
      assignee_type: t.assignee_type,
      estimated_hours: t.estimated_hours,
    });
  }
  return out;
}
