// Backfill embeddings for the RAG corpus (npm run embed).
// No-ops with a clear message when EMBEDDINGS_PROVIDER is unconfigured —
// retrieval then uses the structured fallback, so this is optional.
// Re-embeds rows whose embedding_model doesn't match the current provider.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    console.error("Missing .env.local");
    process.exit(1);
  }
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

const env = loadEnvLocal();
const provider = (env.EMBEDDINGS_PROVIDER ?? "").toLowerCase();

let embedderId, endpoint, headers, buildBody;
if (provider === "voyage" && env.VOYAGE_API_KEY) {
  const model = env.EMBEDDINGS_MODEL || "voyage-3.5";
  embedderId = `voyage:${model}`;
  endpoint = "https://api.voyageai.com/v1/embeddings";
  headers = { Authorization: `Bearer ${env.VOYAGE_API_KEY}`, "Content-Type": "application/json" };
  buildBody = (texts) => ({ model, input: texts, input_type: "document" });
} else if (provider === "openai" && env.OPENAI_API_KEY) {
  const model = env.EMBEDDINGS_MODEL || "text-embedding-3-small";
  embedderId = `openai:${model}`;
  endpoint = "https://api.openai.com/v1/embeddings";
  headers = { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" };
  buildBody = (texts) => ({ model, input: texts });
} else {
  console.log(
    "No embeddings provider configured (EMBEDDINGS_PROVIDER + key). " +
      "Retrieval uses the structured fallback — nothing to do.",
  );
  process.exit(0);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: assets, error } = await admin
  .from("assets")
  .select("id, title, content, embedding_model")
  .or(`embedding_model.is.null,embedding_model.neq.${embedderId}`);
if (error) {
  console.error(`asset query failed: ${error.message}`);
  process.exit(1);
}
if (!assets?.length) {
  console.log(`All assets already embedded with ${embedderId}.`);
  process.exit(0);
}

console.log(`Embedding ${assets.length} asset(s) with ${embedderId}...`);
const BATCH = 16;
for (let i = 0; i < assets.length; i += BATCH) {
  const batch = assets.slice(i, i + BATCH);
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(buildBody(batch.map((a) => `${a.title}\n${a.content}`.slice(0, 8000)))),
  });
  if (!res.ok) {
    console.error(`embeddings request failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  for (const [j, asset] of batch.entries()) {
    const { error: updateError } = await admin
      .from("assets")
      .update({
        embedding: JSON.stringify(body.data[j].embedding),
        embedding_model: embedderId,
      })
      .eq("id", asset.id);
    if (updateError) {
      console.error(`update failed for ${asset.id}: ${updateError.message}`);
      process.exit(1);
    }
  }
  console.log(`  ${Math.min(i + BATCH, assets.length)}/${assets.length}`);
}
console.log("Embedding backfill complete.");
