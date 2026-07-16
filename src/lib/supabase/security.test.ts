/**
 * Guard tests: the service-role key must stay server-side only.
 * These run against the source tree and need no Supabase credentials.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC_DIR = path.join(process.cwd(), "src");
const ADMIN_PATH = path.join(SRC_DIR, "lib", "supabase", "admin.ts");

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(ts|tsx)$/.test(entry.name) &&
        !entry.name.endsWith(".test.ts"),
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("supabase admin client isolation", () => {
  const adminSource = readFileSync(ADMIN_PATH, "utf8");

  it('admin.ts imports "server-only" so it can never be bundled client-side', () => {
    expect(adminSource).toMatch(/^import\s+["']server-only["'];?/m);
  });

  it("admin.ts reads the service-role key without a NEXT_PUBLIC prefix", () => {
    expect(adminSource).toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
    expect(adminSource).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE/);
  });

  it("no source file outside admin.ts references the service-role key", () => {
    const offenders = listSourceFiles(SRC_DIR)
      .filter((file) => path.resolve(file) !== path.resolve(ADMIN_PATH))
      .filter((file) =>
        readFileSync(file, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"),
      );
    expect(offenders).toEqual([]);
  });

  it("the browser client never imports the admin module", () => {
    const browserSource = readFileSync(
      path.join(SRC_DIR, "lib", "supabase", "client.ts"),
      "utf8",
    );
    expect(browserSource).not.toContain("admin");
    expect(browserSource).not.toContain("SERVICE_ROLE");
  });
});
