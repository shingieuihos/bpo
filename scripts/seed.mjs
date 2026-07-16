// ForgeOS seed script — Phase 1.
// Seeds the FIRST auth user's org with: 2 niches, 4 RAG assets, and one
// sample opportunity per source type. All seed rows are clearly marked
// ([SEED] title prefix + is_seed = true) and the script is idempotent:
// re-running replaces previous seed rows instead of duplicating them.
//
// Usage: npm run seed   (requires .env.local with the service-role key)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(step, error) {
  console.error(`Seed failed at ${step}: ${error.message}`);
  process.exit(1);
}

// ── 1. Find the operator (first auth user) ──────────────────────────────────
const { data: userList, error: usersError } = await admin.auth.admin.listUsers();
if (usersError) fail("listUsers", usersError);
const users = userList.users
  // Ignore throwaway accounts from rls.integration.test.ts.
  .filter((u) => !(u.email ?? "").endsWith("@example.com"))
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
if (users.length === 0) {
  console.error(
    "No auth users yet. Run `npm run dev`, sign up at /login, then re-run `npm run seed`.",
  );
  process.exit(1);
}
const operator = users[0];
console.log(`Seeding for operator: ${operator.email}`);

// ── 2. Ensure the operator has an org (users created before the signup
//       trigger existed won't have one) ─────────────────────────────────────
let orgId;
{
  const { data: membership, error } = await admin
    .from("org_members")
    .select("org_id")
    .eq("user_id", operator.id)
    .limit(1)
    .maybeSingle();
  if (error) fail("org lookup", error);

  if (membership) {
    orgId = membership.org_id;
  } else {
    const orgName = `${(operator.email ?? "operator").split("@")[0]}'s workspace`;
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: orgName })
      .select("id")
      .single();
    if (orgError) fail("org create", orgError);
    const { error: memberError } = await admin
      .from("org_members")
      .insert({ org_id: org.id, user_id: operator.id, role: "owner" });
    if (memberError) fail("membership create", memberError);
    orgId = org.id;
    console.log(`Created org "${orgName}" (user pre-dated the signup trigger).`);
  }
}

// ── 3. Niches (upsert by org_id + name) ─────────────────────────────────────
const niches = [
  {
    org_id: orgId,
    name: "Customer Support Ops",
    pricing_model: "Monthly retainer per support pod (AI-assisted agents + QA)",
    target_margin: 55,
    sop_ref: "SOP-CS-001",
    positioning_notes:
      "AI-assisted email/chat support pods for e-commerce brands drowning in tickets. " +
      "Pitch: 24h backlog burn-down, then steady-state SLA. Human QA on every escalation.",
  },
  {
    org_id: orgId,
    name: "Lead Research & Enrichment",
    pricing_model: "Per verified lead + one-time setup fee",
    target_margin: 65,
    sop_ref: "SOP-LR-001",
    positioning_notes:
      "Hand-verified B2B lead lists with AI-assisted enrichment (firmographics, tech stack, " +
      "trigger events). Pitch: accuracy guarantee — replace any bounced contact free.",
  },
];
const { data: upsertedNiches, error: nicheError } = await admin
  .from("niches")
  .upsert(niches, { onConflict: "org_id,name" })
  .select("id,name");
if (nicheError) fail("niches upsert", nicheError);
const nicheId = Object.fromEntries(upsertedNiches.map((n) => [n.name, n.id]));
console.log(`Niches: ${upsertedNiches.map((n) => n.name).join(", ")}`);

// ── 4. Assets (replace previous seed rows) ──────────────────────────────────
{
  const { error } = await admin.from("assets").delete().eq("org_id", orgId).eq("is_seed", true);
  if (error) fail("assets cleanup", error);
}
const assets = [
  {
    org_id: orgId,
    type: "case_study",
    niche_id: nicheId["Customer Support Ops"],
    is_seed: true,
    title: "[SEED] Case study: 3,100-ticket backlog cleared in 9 days for DTC skincare brand",
    content:
      "Client: DTC skincare brand, ~40k orders/mo, support backlog of 3,100 tickets and a 6-day " +
      "first-response time. We deployed a 3-person AI-assisted pod: Claude-drafted responses " +
      "grounded in the brand's macros and order data, every reply human-reviewed before send. " +
      "Result: backlog cleared in 9 days, steady-state first-response under 4 hours, CSAT up " +
      "from 71% to 92%. Ongoing retainer covers 10k tickets/mo with 2 FTE + AI assist — " +
      "delivered at 58% gross margin.",
  },
  {
    org_id: orgId,
    type: "winning_proposal",
    niche_id: nicheId["Lead Research & Enrichment"],
    is_seed: true,
    title: "[SEED] Winning proposal: 2,000 verified fintech leads for B2B SaaS",
    content:
      "The proposal that won a $4,800 engagement. Structure: (1) restate the goal in the " +
      "client's words — 2,000 decision-makers at EU fintechs with 11-200 employees; (2) show " +
      "the exact deliverable — spreadsheet columns listed up front; (3) de-risk — 50-lead free " +
      "sample within 48h, bounce-replacement guarantee; (4) price anchored per verified lead " +
      "($2.40) not per hour; (5) one clear next step. Client replied same day. Key learning: " +
      "the 48h sample is what closed it.",
  },
  {
    org_id: orgId,
    type: "pricing_framework",
    niche_id: null,
    is_seed: true,
    title: "[SEED] Pricing framework: hybrid retainer + per-unit",
    content:
      "Default pricing structure: (1) one-time setup/onboarding fee covering SOP build and " +
      "tooling — never waive it, it filters unserious buyers; (2) monthly retainer sized to " +
      "committed volume at target margin (support: 55%+, research: 65%+); (3) per-unit overage " +
      "priced at 1.3x the blended unit cost inside the retainer. Floor rule: walk away below " +
      "45% projected gross margin unless the logo unlocks a niche we want case studies in.",
  },
  {
    org_id: orgId,
    type: "tone_sample",
    niche_id: null,
    is_seed: true,
    title: "[SEED] Tone sample: operator voice",
    content:
      "Write like this: short sentences, outcome first, zero filler. Never open with 'I hope " +
      "this finds you well.' Open with their problem, stated more precisely than they stated " +
      "it. Numbers over adjectives — '4-hour first response' not 'fast support'. One idea per " +
      "paragraph. End with a single, low-friction next step and a deadline we own, e.g. " +
      "'Sample list by Thursday — if it's not what you expected, no invoice.'",
  },
];
const { data: insertedAssets, error: assetError } = await admin
  .from("assets")
  .insert(assets)
  .select("id");
if (assetError) fail("assets insert", assetError);
console.log(`Assets: ${insertedAssets.length} inserted (embeddings arrive in Phase 4)`);

// ── 5. Opportunities — one per source type (replace previous seed rows) ─────
{
  const { error } = await admin
    .from("opportunities")
    .delete()
    .eq("org_id", orgId)
    .eq("is_seed", true);
  if (error) fail("opportunities cleanup", error);
}
const opportunities = [
  {
    org_id: orgId,
    source: "marketplace_api",
    source_ref: "seed:marketplace:001",
    niche_id: nicheId["Customer Support Ops"],
    is_seed: true,
    title: "[SEED] Customer support team for Shopify store (10k tickets/mo)",
    description:
      "Growing Shopify apparel store needs an outsourced support team for ~10k tickets/month " +
      "across email and chat. Must cover US business hours, integrate with Gorgias, and " +
      "maintain <8h first response. Looking for a monthly engagement, starting within 2 weeks.",
    budget: 3500,
    currency: "USD",
    url: "https://example.com/seed/marketplace/job-001",
    raw_payload: { mock: true, note: "Seed row simulating an official marketplace read-API result." },
  },
  {
    org_id: orgId,
    source: "alert_email",
    source_ref: "seed:alert:001",
    niche_id: nicheId["Lead Research & Enrichment"],
    is_seed: true,
    title: "[SEED] Job alert: lead list building for fintech startup",
    description:
      "From a user-configured job-alert email: Series A fintech wants 1,500 verified leads — " +
      "compliance officers and CFOs at EU payment companies. Needs LinkedIn URL, verified " +
      "email, and one trigger-event note per lead. Deadline: 3 weeks.",
    budget: 800,
    currency: "USD",
    url: "https://example.com/seed/alert/job-001",
    raw_payload: { mock: true, note: "Seed row simulating a parsed marketplace job-alert email." },
  },
  {
    org_id: orgId,
    source: "owned_inbound",
    source_ref: "seed:inbound:001",
    niche_id: nicheId["Customer Support Ops"],
    is_seed: true,
    title: "[SEED] Website form: outsourced support inquiry — homeware brand",
    description:
      "Inbound from our own landing page: homeware DTC brand (~15k orders/mo) asking about " +
      "support outsourcing after a viral TikTok tripled ticket volume. Wants a call this week. " +
      "No budget stated — qualify on the call.",
    budget: null,
    currency: "USD",
    url: null,
    raw_payload: { mock: true, note: "Seed row simulating an owned-funnel form submission." },
  },
  {
    org_id: orgId,
    source: "outbound",
    source_ref: "seed:outbound:001",
    niche_id: nicheId["Lead Research & Enrichment"],
    is_seed: true,
    title: "[SEED] Prospect: DTC coffee brand scaling into wholesale",
    description:
      "From an enriched prospect list import: DTC coffee brand posting wholesale-manager roles " +
      "— likely needs retailer lead lists. Warm angle: they follow our founder on LinkedIn. " +
      "Next step: personalized outreach referencing their wholesale push.",
    budget: null,
    currency: "USD",
    url: "https://example.com/seed/outbound/prospect-001",
    raw_payload: { mock: true, note: "Seed row simulating a CSV prospect-list import." },
  },
];
const { data: insertedOpps, error: oppError } = await admin
  .from("opportunities")
  .insert(opportunities)
  .select("id,source");
if (oppError) fail("opportunities insert", oppError);
console.log(`Opportunities: ${insertedOpps.length} inserted (${insertedOpps.map((o) => o.source).join(", ")})`);

// ── 6. Enqueue scoring jobs for the fresh seed opportunities ────────────────
// (Seed inserts bypass the ingestion pipeline, so enqueue explicitly. Stale
// jobs pointing at deleted seed rows fail permanently and harmlessly.)
{
  const { error } = await admin.from("job_queue").insert(
    insertedOpps.map((o) => ({
      org_id: orgId,
      job_type: "score_opportunity",
      payload: { opportunity_id: o.id },
    })),
  );
  if (error) fail("scoring enqueue", error);
  console.log(`Queued ${insertedOpps.length} scoring jobs (run via the app's "Run scoring now" button or the cron worker).`);
}

console.log("Seed complete.");
