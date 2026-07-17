/**
 * MCP server protocol tests — exercised by calling the route handler
 * directly (no HTTP server needed). Auth, initialize, and tools/list are
 * DB-free; a live tools/call runs when Supabase creds exist.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

function loadEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => [
          l.slice(0, l.indexOf("=")).trim(),
          l.slice(l.indexOf("=") + 1).trim(),
        ]),
    );
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const haveSupabase = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY,
);
const SECRET = "test-mcp-secret";

function rpcRequest(body: unknown, token?: string): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("MCP server protocol", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env.MCP_SECRET = SECRET;
    if (haveSupabase) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    }
    ({ POST } = await import("@/app/api/mcp/route"));
  });

  it("rejects missing/wrong bearer tokens", async () => {
    const noAuth = await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "ping" }));
    expect(noAuth.status).toBe(401);
    const badAuth = await POST(
      rpcRequest({ jsonrpc: "2.0", id: 1, method: "ping" }, "wrong"),
    );
    expect(badAuth.status).toBe(401);
  });

  it("initialize negotiates a supported protocol version", async () => {
    const res = await POST(
      rpcRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {} },
        },
        SECRET,
      ),
    );
    const body = await res.json();
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("forgeos");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("lists exactly the four read/draft tools — nothing send-like", async () => {
    const res = await POST(
      rpcRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, SECRET),
    );
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "draft_proposal",
      "list_top_opportunities",
      "pipeline_summary",
      "score_queue",
    ]);
    for (const name of names) {
      expect(name).not.toMatch(/send|approve|submit|outcome/i);
    }
  });

  it("acknowledges notifications and rejects unknown methods", async () => {
    const notif = await POST(
      rpcRequest({ jsonrpc: "2.0", method: "notifications/initialized" }, SECRET),
    );
    expect(notif.status).toBe(202);

    const unknown = await POST(
      rpcRequest({ jsonrpc: "2.0", id: 3, method: "bogus/method" }, SECRET),
    );
    const body = await unknown.json();
    expect(body.error.code).toBe(-32601);
  });

  it.skipIf(!haveSupabase)(
    "tools/call works end-to-end against the live database",
    async () => {
      const listRes = await POST(
        rpcRequest(
          {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "list_top_opportunities", arguments: { limit: 5 } },
          },
          SECRET,
        ),
      );
      const listBody = await listRes.json();
      expect(listBody.result.isError).toBeUndefined();
      const parsed = JSON.parse(listBody.result.content[0].text);
      expect(parsed.weights).toBeDefined();
      expect(Array.isArray(parsed.opportunities)).toBe(true);

      const summaryRes = await POST(
        rpcRequest(
          {
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "pipeline_summary", arguments: {} },
          },
          SECRET,
        ),
      );
      const summaryBody = await summaryRes.json();
      const metrics = JSON.parse(summaryBody.result.content[0].text);
      expect(metrics.pipelineByStage).toHaveLength(5);
      expect(typeof metrics.openPipelineValue).toBe("number");
    },
    40_000,
  );
});
