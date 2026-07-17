import { NextResponse } from "next/server";

import { resolveIngestOrg } from "@/lib/ingestion/create-opportunity";
import { secureCompare } from "@/lib/ingestion/secure-compare";
import { draftProposalForOpportunity } from "@/lib/proposals/draft";
import { computeMetrics, type ReportDeal } from "@/lib/reporting/metrics";
import { compositeScore, parseWeights } from "@/lib/scoring/composite";
import { processScoreJobs } from "@/lib/scoring/worker";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // draft_proposal calls Claude

/**
 * ForgeOS MCP server — Streamable HTTP transport, stateless, hand-rolled
 * JSON-RPC (tools-only servers don't need an SDK dependency).
 *
 * Connect from Claude Code:
 *   claude mcp add --transport http forgeos https://<host>/api/mcp \
 *     --header "Authorization: Bearer $MCP_SECRET"
 *
 * ── COMPLIANCE ──────────────────────────────────────────────────────────────
 * READ + DRAFT ONLY. There is deliberately no tool that approves, sends,
 * records outcomes, or touches a marketplace. The human approval gate lives
 * exclusively in the app (src/lib/proposals/approve.ts) — enforced by the
 * no-auto-send compliance test, which forbids this file (and all API routes)
 * from importing the gate or writing proposal status.
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const SERVER_INFO = { name: "forgeos", version: "1.0.0" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOLS = [
  {
    name: "list_top_opportunities",
    description:
      "The ranked opportunity queue: top opportunities by composite score (fit, margin, urgency, low-effort — using the operator's saved weights), with per-dimension scores and rationale.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows (default 10, max 50)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "score_queue",
    description:
      "Process pending AI-scoring jobs for new opportunities (up to 10 per call). Returns a summary of scored/retried/failed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "draft_proposal",
    description:
      "Draft a proposal for an opportunity, grounded in the RAG corpus. Creates a DRAFT only — a human must edit, approve, and send it in the ForgeOS app; MCP can never send.",
    inputSchema: {
      type: "object",
      properties: {
        opportunity_id: { type: "string", description: "Opportunity uuid" },
      },
      required: ["opportunity_id"],
      additionalProperties: false,
    },
  },
  {
    name: "pipeline_summary",
    description:
      "Revenue metrics computed live from the pipeline: value by stage, win rate, won revenue, delivery cost, gross margin per niche and project, cash timing by month.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

async function callTool(name: string, args: Record<string, unknown>) {
  const orgId = await resolveIngestOrg(null);
  const admin = createAdminClient();

  switch (name) {
    case "list_top_opportunities": {
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
      const [{ data: org }, { data: opportunities }] = await Promise.all([
        admin.from("organizations").select("settings").eq("id", orgId).single(),
        admin
          .from("opportunities")
          .select(
            "id, title, source, status, budget, currency, fit_score, margin_potential_score, urgency_score, effort_score, score_rationale, niches (name)",
          )
          .eq("org_id", orgId)
          .neq("status", "archived")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      const weights = parseWeights(org?.settings);
      const ranked = (opportunities ?? [])
        .map((o) => ({
          id: o.id,
          title: o.title,
          source: o.source,
          status: o.status,
          budget: o.budget,
          currency: o.currency,
          niche: o.niches?.name ?? null,
          scores: {
            fit: o.fit_score,
            margin_potential: o.margin_potential_score,
            urgency: o.urgency_score,
            effort: o.effort_score,
          },
          rationale: o.score_rationale,
          composite: compositeScore(o, weights),
        }))
        .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))
        .slice(0, limit);
      return { weights, opportunities: ranked };
    }

    case "score_queue": {
      return await processScoreJobs({ limit: 10, orgId });
    }

    case "draft_proposal": {
      const opportunityId = String(args.opportunity_id ?? "");
      if (!opportunityId) throw new Error("opportunity_id is required");
      const { proposalId, draft } = await draftProposalForOpportunity({
        opportunityId,
        orgId,
        actorId: null,
        via: "mcp",
      });
      return {
        proposal_id: proposalId,
        draft,
        next_step:
          "A human must review, edit, approve, and send this in the ForgeOS app (/proposals). MCP cannot send proposals.",
      };
    }

    case "pipeline_summary": {
      const { data: dealRows } = await admin
        .from("deals")
        .select(
          "id, stage, value, currency, estimated_delivery_cost, actual_delivery_cost, gross_margin, win_probability, created_at, won_at, opportunities (title, niches (name))",
        )
        .eq("org_id", orgId)
        .limit(1000);
      const deals: ReportDeal[] = (dealRows ?? []).map((d) => ({
        id: d.id,
        stage: d.stage,
        value: d.value != null ? Number(d.value) : null,
        currency: d.currency,
        estimated_delivery_cost:
          d.estimated_delivery_cost != null ? Number(d.estimated_delivery_cost) : null,
        actual_delivery_cost:
          d.actual_delivery_cost != null ? Number(d.actual_delivery_cost) : null,
        gross_margin: d.gross_margin != null ? Number(d.gross_margin) : null,
        win_probability: d.win_probability,
        created_at: d.created_at,
        won_at: d.won_at,
        title: d.opportunities?.title ?? null,
        nicheName: d.opportunities?.niches?.name ?? null,
      }));
      return computeMetrics(deals);
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}
function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function POST(request: Request) {
  const secret = process.env.MCP_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "MCP server is not configured (MCP_SECRET unset)" },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization") ?? "";
  if (!secureCompare(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let rpc: JsonRpcRequest;
  try {
    rpc = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "parse error");
  }

  // Notifications (no id) are acknowledged without a body.
  if (rpc.id === undefined && rpc.method?.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202 });
  }

  try {
    switch (rpc.method) {
      case "initialize": {
        const requested = String(rpc.params?.protocolVersion ?? "");
        return rpcResult(rpc.id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested)
            ? requested
            : "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      case "ping":
        return rpcResult(rpc.id, {});
      case "tools/list":
        return rpcResult(rpc.id, { tools: TOOLS });
      case "tools/call": {
        const name = String(rpc.params?.name ?? "");
        const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const result = await callTool(name, args);
          return rpcResult(rpc.id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          });
        } catch (err) {
          return rpcResult(rpc.id, {
            content: [
              {
                type: "text",
                text: `Error: ${err instanceof Error ? err.message : "tool failed"}`,
              },
            ],
            isError: true,
          });
        }
      }
      default:
        return rpcError(rpc.id, -32601, `method not found: ${rpc.method}`);
    }
  } catch (err) {
    return rpcError(
      rpc.id,
      -32603,
      err instanceof Error ? err.message : "internal error",
    );
  }
}

/** Stateless server: no SSE stream to resume. */
export async function GET() {
  return new NextResponse(null, { status: 405 });
}
