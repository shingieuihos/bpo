# Master Build Prompt — AI-Assisted Agency / BPO Pipeline

> **How to use this.** Paste this whole document into an agentic coding tool (Claude Code, Cursor, or Cline) at the root of an empty repo. It is written to be executed **one phase at a time**. The agent must stop at the end of each phase, show you what works, and wait for your go-ahead before continuing. Replace `<PROJECT_NAME>` with your chosen name before you start (or tell the agent to prompt you for it).

---

## ROLE

You are a senior full-stack engineer and pragmatic technical lead. You are building a **production** internal platform, not a demo. You favour boring, proven patterns over clever ones. You write typed, tested, secure code. You do not add scope you weren't asked for. When a decision affects cost, compliance, security, or the data model, you flag it and ask before proceeding.

---

## PRODUCT

`<PROJECT_NAME>` is an internal operating system for running an AI-assisted outsourcing / agency business end to end:

1. **Source** opportunities from multiple channels into one queue.
2. **Score** each opportunity for fit, margin, urgency, and effort.
3. **Draft** tailored proposals with AI, grounded in our own past work — reviewed and sent by a human.
4. **Track** the pipeline from opportunity → proposal → deal → client.
5. **Deliver** the work by orchestrating AI + subcontractors through a QA gate.
6. **Report** on pipeline value, win rate, and — critically — **gross margin per project**.

Single-operator to start; designed to add seats later. The point of the system is leverage: the operator's time goes to judgment (which opportunities, editing proposals, QA), and the software does the drudgery (ingestion, scoring, first-draft generation, reporting).

---

## NON-NEGOTIABLE PRINCIPLES — read first, never violate

**Compliance (this is the whole reason the business is durable — do not cut corners):**
- **No scraping.** Never scrape, crawl, or use a headless browser (Selenium/Puppeteer/Playwright) against any freelance marketplace (Upwork, Freelancer, Fiverr, etc.) job feed, search, or profile. Marketplace data enters the system **only** through (a) official, approved read APIs, or (b) user-configured email / RSS job alerts that the user has set up inside the marketplace.
- **No auto-submission.** Never build anything that submits a proposal, sends a bid, spends Connects/credits, or takes any action on a marketplace on the user's behalf. Every proposal is **drafted by AI but reviewed and submitted by a human**. Implement a hard human-in-the-loop gate: a proposal cannot leave the system as "sent" without an explicit human approval action, which is recorded in the audit log.
- **No credential sharing / masquerading.** Never store marketplace passwords or act as the user inside a third-party marketplace session.

**Security:**
- Secrets (API keys, service-role keys) live server-side only. Never ship them in the client bundle or expose them to the browser.
- Row-Level Security on **every** table. Nothing is world-readable.
- Never put PII, secrets, or full API payloads in logs, error messages, or URLs.

**Data handling (POPIA-aware):**
- Store only what the system needs. Classify records that contain client/personal data.
- Provide affordances to export and delete a client's data.
- Keep an audit trail of every outbound proposal send (who, what, when).

**Engineering discipline:**
- Ship each phase **working and tested** before moving on. No half-built phases carried forward.
- Prefer proven patterns. Ask before introducing a new dependency that isn't in the locked stack.

---

## TECH STACK — locked

- **Next.js** (App Router, **TypeScript**)
- **Supabase** — Postgres, Auth, Row-Level Security, Edge Functions, Storage
- **Anthropic Claude API** (server-side only) for scoring, proposal drafting, and delivery assistance. Model name and API key come from env; make the model configurable.
- **Background work** — Supabase scheduled functions (cron) plus a lightweight queue table for async ingestion + scoring. No heavy external queue unless you justify it and I approve.
- **UI** — Tailwind CSS + shadcn/ui.
- **Deploy target** — Vercel.
- **Optional (Phase 8)** — expose core actions as an MCP server.

Provide a `.env.example` documenting every variable. Never commit real secrets.

---

## DATA MODEL — build in Phase 1, extend only as later phases require

Design the schema; these are the entities and the key fields. Add sensible timestamps, foreign keys, and enums.

- **organizations** — tenant boundary (future-proofing multi-seat).
- **users** — via Supabase Auth; role per org.
- **niches** — `name`, `pricing_model`, `target_margin`, `sop_ref`, `positioning_notes`. This is config that drives ingestion filters, scoring, and delivery.
- **opportunities** — `source` (enum: marketplace_api / alert_email / owned_inbound / outbound), `source_ref`, `raw_payload` (jsonb), `niche_id`, `title`, `description`, `budget`, `currency`, `url`, `status` (enum: new / scored / drafting / proposed / won / lost / archived), scoring fields (see Phase 3), `created_at`.
- **proposals** — `opportunity_id`, `draft` (AI output), `final` (human-edited), `status` (enum: draft / approved / sent / archived), `approved_by`, `sent_at`, `outcome` (enum: pending / reply / shortlisted / won / lost / no_response).
- **deals** — `opportunity_id`, `client_id`, `stage` (enum), `value`, `currency`, `estimated_delivery_cost`, `gross_margin` (computed), `win_probability`, `next_action_at`, `next_action_note`.
- **clients** — `name`, `contact`, `source`, `first_won_at`, `lifetime_value` (computed), `notes`, `data_classification`.
- **assets** — RAG corpus: `type` (enum: case_study / winning_proposal / pricing_framework / tone_sample), `title`, `content`, `embedding` (pgvector), `niche_id` (nullable). This is what makes proposals specific instead of generic.
- **delivery_jobs** — `deal_id`, `brief`, `tasks` (jsonb task list), `assignee_type` (enum: ai / contractor), `assignee_ref`, `status`, `qa_status` (enum: pending / passed / rework), `qa_notes`.
- **contractors** — `name`, `skills` (array), `rate`, `currency`, `rating`, `notes`.
- **audit_events** — `actor`, `action`, `entity_type`, `entity_id`, `metadata` (jsonb), `created_at`. **Every proposal approval/send writes here.**

---

## PHASED BUILD PLAN

Work **one phase at a time**. At the end of each phase: run it, give me a short summary of what works, list anything stubbed or deferred, note any decisions that changed cost/compliance/data model, then **wait for my explicit go-ahead**. Make a small, reviewable commit per phase.

### Phase 0 — Scaffold & config
- Initialise Next.js (App Router, TypeScript, Tailwind, shadcn/ui). Set up Supabase project wiring, local dev, and a Supabase client (server + browser split, service-role key server-only).
- Add `.env.example`, a README with setup steps, linting, and a basic CI-friendly test runner.
- **Acceptance:** app boots locally, connects to Supabase, one protected page behind auth renders. No business logic yet.

### Phase 1 — Data model + RLS + seed
- Implement the full schema above as Supabase migrations. Enable pgvector for `assets.embedding`. Add RLS policies on every table (org-scoped).
- Seed script with: 2 example niches, a handful of example assets, and one sample opportunity in each `source` type (clearly marked as seed/mock).
- **Acceptance:** migrations run clean; RLS verified (a query from one org cannot read another org's rows); seed populates; types generated from the DB.

### Phase 2 — Opportunity ingestion (multi-source, compliant)
Build ingestion for three source types into `opportunities`, plus a queue for async processing. **Re-read the compliance principles before writing any of this.**
- **Marketplace (read-only):** an adapter interface with a stubbed implementation for an official marketplace **read** API (e.g. job search / read endpoints) behind a feature flag and an approval note in the README. If no API key is present, this adapter is inert. **Do not implement any scraping fallback.**
- **Alert intake:** an inbound email endpoint (or a parseable inbox integration) that ingests marketplace **job-alert emails the user configured themselves**, extracts fields, and creates opportunities.
- **Owned inbound:** a public form / webhook endpoint that captures leads from the operator's own funnels/landing pages into `opportunities` (source = owned_inbound).
- **Outbound:** a CSV/JSON import for enriched prospect lists (source = outbound).
- A dedup step so the same opportunity isn't ingested twice.
- **Acceptance:** each source can create an opportunity; alert-email parsing works on a sample email; dedup works; nothing scrapes; marketplace adapter is inert without credentials.

### Phase 3 — AI scoring layer
- A server-side Claude call that scores each new opportunity against its niche on: **fit** (0–100), **margin_potential**, **urgency**, **effort**, plus a one-line rationale. Store structured results; process via the queue so scoring is async and retry-safe. Model configurable via env; strict JSON output parsed safely.
- Rank the queue by a composite score the operator can re-weight.
- **Acceptance:** ingesting an opportunity triggers scoring; results are structured and stored; the ranked queue renders; failures retry without duplicating.

### Phase 4 — Proposal engine (RAG + human-in-the-loop gate)
- Given an opportunity, retrieve the most relevant `assets` (vector search over the RAG corpus, filtered by niche), then a Claude call drafts a specific, referenced proposal in the operator's tone. Save to `proposals.draft`.
- **Editing UI:** operator edits the draft into `proposals.final`.
- **Approval gate (hard requirement):** a proposal moves to `sent` **only** via an explicit "Approve & mark sent" action that requires a human user, writes an `audit_events` row, and stamps `approved_by` + `sent_at`. There is **no** code path that auto-sends. The system never submits to a marketplace — "sent" means the human sent it themselves; the system only records it.
- Capture `outcome` afterward so the corpus/scoring can learn which framings win.
- **Acceptance:** draft is grounded in retrieved assets (not generic); edit → approve → audit-logged works; there is provably no auto-send path.

### Phase 5 — Pipeline + CRM UI
- Board/list views over `opportunities → proposals → deals → clients` with stages, value, win-probability, and `next_action_at`. Drag-and-drop or quick stage change. Client detail view with history and data classification.
- **Acceptance:** an opportunity can be walked all the way to a won deal + client record; next actions are visible and sortable; everything is org-scoped.

### Phase 6 — Delivery orchestration workspace
- From a won deal, create a `delivery_job`: intake brief → Claude decomposes it into a task list → each task routed to `ai` (Claude assists/drafts) or `contractor` (assigned from `contractors`) → **QA gate** (`qa_status`) before the job is marked delivered. Attach SOP references per niche.
- Track estimated vs actual delivery cost so `deals.gross_margin` reflects reality.
- **Acceptance:** a deal spawns a delivery job with tasks; AI-assisted tasks produce first drafts; QA gate blocks delivery until passed; delivery cost feeds margin.

### Phase 7 — Revenue dashboard
- A reporting view on the existing DB: pipeline value by stage, win rate, **gross margin per project and per niche**, delivery cost, client LTV, and cash timing. Simple charts; date filtering.
- **Acceptance:** metrics compute correctly from real records (verify against a manual calculation on seed data); no separate data store introduced.

### Phase 8 — (optional) MCP server + polish
- Expose core read/act operations as an MCP server so the pipeline is callable from Claude directly: e.g. `list_top_opportunities`, `score_queue`, `draft_proposal(opportunity_id)`, `pipeline_summary`. **The approval/send gate still requires a human in the app — MCP tools never send.**
- Polish: empty states, error handling, loading states, and a short operator runbook in the README.
- **Acceptance:** MCP tools work from a Claude client for read/draft actions; no MCP tool can send a proposal or take a marketplace action.

---

## THINGS YOU MUST NOT DO

- ❌ Scrape or crawl any marketplace, or drive one with a headless browser.
- ❌ Auto-submit proposals, spend Connects/credits, or take any action inside a marketplace on the user's behalf.
- ❌ Store marketplace passwords or act as the user in a marketplace session.
- ❌ Put secrets or PII in the client bundle, logs, or URLs.
- ❌ Leave a table without RLS.
- ❌ Carry a broken/half-built phase forward.
- ❌ Add scope, dependencies, or "nice to haves" I didn't ask for without flagging first.

---

## WORKING AGREEMENT

- **Checkpoint every phase.** Stop, summarise, list stubs/decisions, wait for my go-ahead.
- **Ask before destructive actions** (dropping tables, rewriting migrations, deleting data).
- **Use env vars**; keep `.env.example` current; never commit real secrets.
- **Test the logic that matters:** scoring output parsing, the proposal approval gate (assert there is no auto-send path), and the margin calculation.
- **Flag trade-offs** that change cost, compliance, security, or the data model, with a one-line recommendation, and let me decide.

**Kickoff:** Confirm the project name, restate the phase plan in one line each, then begin **Phase 0** and stop at its acceptance criteria.
