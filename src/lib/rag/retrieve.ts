import "server-only";

import type { Database } from "@/lib/database.types";
import { getEmbeddingsClient } from "@/lib/rag/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";

export type AssetType = Database["public"]["Enums"]["asset_type"];

export interface RetrievedAsset {
  id: string;
  type: AssetType;
  title: string;
  content: string;
  via: "vector" | "structured";
}

/**
 * Retrieve the assets that ground a proposal draft.
 *
 * Vector path (when an embeddings provider is configured): embed the
 * opportunity text and cosine-match via the match_assets() SQL function,
 * niche-boosted. Tone/pricing assets are guaranteed a seat even if they
 * don't win on similarity — a proposal without the operator's voice and
 * pricing rules is grounded in the wrong things.
 *
 * Structured fallback (no provider): deterministic type-aware selection —
 * niche-matched first, then org-wide: up to 2 case studies, 2 winning
 * proposals, 1 pricing framework, 1 tone sample, newest first.
 */
export async function retrieveAssets(params: {
  orgId: string;
  nicheId: string | null;
  queryText: string;
}): Promise<RetrievedAsset[]> {
  const admin = createAdminClient();
  const embedder = getEmbeddingsClient();

  if (embedder) {
    try {
      const [embedding] = await embedder.embed([params.queryText.slice(0, 8000)]);
      const { data, error } = await admin.rpc("match_assets", {
        p_org_id: params.orgId,
        p_embedding: JSON.stringify(embedding),
        p_niche_id: params.nicheId ?? undefined,
        p_limit: 6,
      });
      if (error) throw new Error(error.message);
      if (data && data.length > 0) {
        const matched: RetrievedAsset[] = data.map((a) => ({
          id: a.id,
          type: a.type,
          title: a.title,
          content: a.content,
          via: "vector" as const,
        }));
        // Guarantee voice + pricing grounding.
        for (const mustHave of ["tone_sample", "pricing_framework"] as const) {
          if (!matched.some((a) => a.type === mustHave)) {
            const extra = await pickByType(params, mustHave, 1);
            matched.push(...extra);
          }
        }
        return matched;
      }
      // No embedded assets yet → fall through to the structured strategy.
    } catch (err) {
      console.error(
        `vector retrieval failed, using structured fallback: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }
  }

  const [caseStudies, winning, pricing, tone] = await Promise.all([
    pickByType(params, "case_study", 2),
    pickByType(params, "winning_proposal", 2),
    pickByType(params, "pricing_framework", 1),
    pickByType(params, "tone_sample", 1),
  ]);
  return [...caseStudies, ...winning, ...pricing, ...tone];
}

/** Niche-specific assets first, then global (niche_id null), newest first. */
async function pickByType(
  params: { orgId: string; nicheId: string | null },
  type: AssetType,
  limit: number,
): Promise<RetrievedAsset[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("assets")
    .select("id, type, title, content, niche_id, created_at")
    .eq("org_id", params.orgId)
    .eq("type", type)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !data) return [];

  const nicheFirst = [...data].sort((a, b) => {
    const aNiche = params.nicheId && a.niche_id === params.nicheId ? 0 : 1;
    const bNiche = params.nicheId && b.niche_id === params.nicheId ? 0 : 1;
    return aNiche - bNiche;
  });
  return nicheFirst.slice(0, limit).map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    content: a.content,
    via: "structured" as const,
  }));
}
