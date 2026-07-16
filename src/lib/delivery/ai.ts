import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  validateDecomposition,
  type DecomposedTask,
} from "@/lib/delivery/tasks";
import { scoringModel } from "@/lib/scoring/score-opportunity";

const DECOMPOSE_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short imperative task title" },
          description: {
            type: "string",
            description: "What done looks like for this task, concretely",
          },
          assignee_type: {
            type: "string",
            enum: ["ai", "contractor"],
            description:
              "ai when the task is drafting/research/analysis Claude can first-draft; contractor when it needs a human's hands, judgment, or client contact",
          },
          estimated_hours: {
            type: "number",
            description: "Realistic hours of human effort (including review of AI drafts)",
          },
        },
        required: ["title", "description", "assignee_type", "estimated_hours"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
} as const;

const DECOMPOSE_SYSTEM = `You decompose delivery briefs for an AI-assisted agency/BPO into executable task lists. 3-10 tasks, ordered by execution sequence. Each task is small enough to verify independently. Route drafting/research/analysis tasks to "ai" (Claude produces a first draft, a human reviews); route anything needing human hands, judgment calls, or client contact to "contractor". Always end with a final quality-review task routed to "contractor". Estimates are honest human-hours including review time.`;

export async function decomposeBrief(input: {
  brief: string;
  nicheName: string | null;
  sopRef: string | null;
}): Promise<DecomposedTask[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: scoringModel(),
    max_tokens: 3000,
    system: DECOMPOSE_SYSTEM,
    output_config: { format: { type: "json_schema", schema: DECOMPOSE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          input.nicheName ? `Niche: ${input.nicheName}` : null,
          input.sopRef ? `Follow SOP: ${input.sopRef}` : null,
          `Brief:\n${input.brief.slice(0, 8000)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("decomposition declined by model safety systems");
  }
  const text = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  )?.text;
  if (!text) throw new Error("decomposition response contained no text");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("decomposition response was not valid JSON");
  }
  const tasks = validateDecomposition(parsed);
  if (!tasks) throw new Error("decomposition failed validation");
  return tasks;
}

const TASK_DRAFT_SYSTEM = `You produce the FIRST DRAFT for a single delivery task inside an AI-assisted agency. A human will review and finish it — aim for 80% done, clearly structured, no filler. If the task needs information you don't have, produce the best structure and mark gaps with [NEEDS INPUT: ...] so the reviewer fills them fast. Output plain markdown.`;

export async function draftTask(input: {
  brief: string;
  taskTitle: string;
  taskDescription: string;
  nicheName: string | null;
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: scoringModel(),
    max_tokens: 4096,
    system: TASK_DRAFT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          input.nicheName ? `Niche: ${input.nicheName}` : null,
          `Job brief:\n${input.brief.slice(0, 6000)}`,
          `Task: ${input.taskTitle}`,
          `Task detail: ${input.taskDescription}`,
          "Produce the first draft now.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("task drafting declined by model safety systems");
  }
  const draft = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!draft) throw new Error("task draft was empty");
  return draft;
}
