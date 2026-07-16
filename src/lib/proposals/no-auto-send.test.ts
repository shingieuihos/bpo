import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Compliance guard — "there is provably no auto-send path".
 *
 * Proposals reach status 'sent' ONLY through the human approval gate
 * (src/lib/proposals/approve.ts, triggered by the signed-in server action in
 * src/app/proposals/actions.ts). These tests scan the source tree and fail
 * if any other file ever writes a 'sent' status, and if automation surfaces
 * (ingestion, scoring, API routes) ever touch the proposals table.
 */

const SRC = join(process.cwd(), "src");

/** Files allowed to reference the literal proposal status "sent" in writes. */
const GATE_FILES = [
  ["src", "lib", "proposals", "approve.ts"].join(sep),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("compliance: no auto-send path", () => {
  const files = walk(SRC);

  it("only the approval gate writes proposal status 'sent'", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(process.cwd(), file);
      if (GATE_FILES.some((g) => rel.endsWith(g))) continue;
      const source = readFileSync(file, "utf8");
      // A write is an update/insert payload assigning the literal status.
      if (/status:\s*["']sent["']/.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `files writing status 'sent' outside the gate: ${offenders.join(", ")}`).toEqual([]);
  });

  it("automated surfaces (ingestion, scoring, API routes) never write proposals", () => {
    const automatedDirs = [
      join(SRC, "lib", "ingestion"),
      join(SRC, "lib", "scoring"),
      join(SRC, "app", "api"),
    ];
    const offenders: string[] = [];
    for (const dir of automatedDirs) {
      for (const file of walk(dir)) {
        const source = readFileSync(file, "utf8");
        if (/from\(\s*["']proposals["']\s*\)/.test(source)) {
          offenders.push(relative(process.cwd(), file));
        }
      }
    }
    expect(offenders, `automated code touching proposals: ${offenders.join(", ")}`).toEqual([]);
  });

  it("nothing in the codebase transmits proposals externally", () => {
    // The proposals modules must not perform any outbound HTTP other than the
    // Anthropic SDK call used for drafting (no fetch to marketplaces, no
    // email/webhook dispatch of proposal content).
    for (const file of walk(join(SRC, "lib", "proposals"))) {
      const source = readFileSync(file, "utf8");
      expect(source, `unexpected outbound fetch in ${relative(process.cwd(), file)}`).not.toMatch(
        /fetch\s*\(/,
      );
    }
  });
});
