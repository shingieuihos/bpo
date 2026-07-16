// Supabase CLI wrapper that loads credentials from .env.local so commands
// like `npm run db:push` work without exporting secrets into the shell.
//
// Usage:
//   node scripts/db.mjs link            # link repo to the cloud project
//   node scripts/db.mjs db push         # apply migrations to the cloud DB
//   node scripts/db.mjs types           # regenerate src/lib/database.types.ts
//   node scripts/db.mjs <any cli args>  # passthrough, e.g. `db advisors`
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    console.error("Missing .env.local — copy .env.example and fill in values.");
    process.exit(1);
  }
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [
        l.slice(0, l.indexOf("=")).trim(),
        l.slice(l.indexOf("=") + 1).trim(),
      ]),
  );
}

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!url) {
  console.error("NEXT_PUBLIC_SUPABASE_URL missing from .env.local");
  process.exit(1);
}
const projectRef = new URL(url).hostname.split(".")[0];

// The CLI reads these env vars; we never print them.
const cliEnv = {
  ...process.env,
  SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN ?? "",
  SUPABASE_DB_PASSWORD: env.SUPABASE_DATABASE_PASSWORD ?? "",
};

function run(args, opts = {}) {
  const result = spawnSync("npx", ["supabase", ...args], {
    stdio: opts.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    env: cliEnv,
    shell: true,
    encoding: "utf8",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "link") {
  run(["link", "--project-ref", projectRef, ...rest]);
} else if (cmd === "types") {
  const out = run(
    ["gen", "types", "typescript", "--linked", "--schema", "public"],
    { capture: true },
  );
  writeFileSync("src/lib/database.types.ts", out);
  console.log("Wrote src/lib/database.types.ts");
} else {
  run([cmd, ...rest].filter(Boolean));
}
