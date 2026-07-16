import { describe, expect, it } from "vitest";

import {
  allTasksDone,
  parseTasks,
  totalTaskCost,
  validateDecomposition,
} from "@/lib/delivery/tasks";

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  title: "Build the list",
  description: "desc",
  assignee_type: "ai",
  assignee_ref: null,
  status: "todo",
  estimated_hours: 2,
  ai_draft: null,
  cost: null,
  ...over,
});

describe("parseTasks", () => {
  it("round-trips valid tasks and defaults malformed fields", () => {
    const parsed = parseTasks([
      task(),
      task({ id: "t2", status: "bogus", assignee_type: "nonsense", cost: -5 }),
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toMatchObject({
      status: "todo",
      assignee_type: "ai",
      cost: null,
    });
  });

  it("never crashes on garbage", () => {
    expect(parseTasks(null)).toEqual([]);
    expect(parseTasks("junk")).toEqual([]);
    expect(parseTasks([{ no: "id" }, 42, null])).toEqual([]);
  });
});

describe("totalTaskCost / allTasksDone", () => {
  it("sums costs and detects completion", () => {
    const tasks = parseTasks([
      task({ status: "done", cost: 120.5 }),
      task({ id: "t2", status: "done", cost: 79.5 }),
    ]);
    expect(totalTaskCost(tasks)).toBe(200);
    expect(allTasksDone(tasks)).toBe(true);
  });

  it("an undone task or empty list is not complete", () => {
    expect(allTasksDone([])).toBe(false);
    expect(
      allTasksDone(parseTasks([task({ status: "done" }), task({ id: "t2" })])),
    ).toBe(false);
  });
});

describe("validateDecomposition (strict Claude output parsing)", () => {
  const good = {
    tasks: [
      {
        title: "Research target list",
        description: "Compile 200 prospects",
        assignee_type: "ai",
        estimated_hours: 3,
      },
      {
        title: "Final quality review",
        description: "Check everything",
        assignee_type: "contractor",
        estimated_hours: 1,
      },
    ],
  };

  it("accepts a valid decomposition", () => {
    expect(validateDecomposition(good)).toHaveLength(2);
  });

  it("rejects empty, oversized, and malformed payloads", () => {
    expect(validateDecomposition({ tasks: [] })).toBeNull();
    expect(
      validateDecomposition({ tasks: Array(13).fill(good.tasks[0]) }),
    ).toBeNull();
    expect(
      validateDecomposition({
        tasks: [{ ...good.tasks[0], assignee_type: "robot" }],
      }),
    ).toBeNull();
    expect(
      validateDecomposition({
        tasks: [{ ...good.tasks[0], estimated_hours: -1 }],
      }),
    ).toBeNull();
    expect(validateDecomposition(null)).toBeNull();
  });
});
