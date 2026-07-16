import "server-only";

/**
 * Provider-agnostic embeddings via plain fetch — no extra SDK dependencies.
 *
 * Configure with env:
 *   EMBEDDINGS_PROVIDER = "voyage" | "openai" | "" (unset → vector search off,
 *   retrieval falls back to the deterministic type-aware strategy)
 *   VOYAGE_API_KEY / OPENAI_API_KEY, optional EMBEDDINGS_MODEL override.
 *
 * Defaults: voyage-3.5 (1024 dims) / text-embedding-3-small (1536 dims).
 * assets.embedding is dimension-flexible; assets.embedding_model records the
 * "<provider>:<model>" that embedded each row so provider switches trigger
 * re-embedding (npm run embed).
 */

export interface EmbeddingsClient {
  /** "<provider>:<model>" identifier stored alongside embeddings. */
  id: string;
  embed(texts: string[]): Promise<number[][]>;
}

export function getEmbeddingsClient(): EmbeddingsClient | null {
  const provider = process.env.EMBEDDINGS_PROVIDER?.trim().toLowerCase();
  if (provider === "voyage") {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) return null;
    const model = process.env.EMBEDDINGS_MODEL?.trim() || "voyage-3.5";
    return {
      id: `voyage:${model}`,
      embed: async (texts) => {
        const res = await fetch("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, input: texts, input_type: "document" }),
        });
        if (!res.ok) throw new Error(`voyage embeddings failed: HTTP ${res.status}`);
        const body = (await res.json()) as { data: { embedding: number[] }[] };
        return body.data.map((d) => d.embedding);
      },
    };
  }
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    const model = process.env.EMBEDDINGS_MODEL?.trim() || "text-embedding-3-small";
    return {
      id: `openai:${model}`,
      embed: async (texts) => {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, input: texts }),
        });
        if (!res.ok) throw new Error(`openai embeddings failed: HTTP ${res.status}`);
        const body = (await res.json()) as { data: { embedding: number[] }[] };
        return body.data.map((d) => d.embedding);
      },
    };
  }
  return null;
}
