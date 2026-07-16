# ForgeOS

ForgeOS is the internal platform for running an AI-assisted agency/BPO business — client work, delivery pipelines, and operations in one place.
Built in phases; this repo currently contains **Phase 0** (authenticated application shell) and **Phase 1** (full data model with org-scoped Row Level Security, pgvector RAG corpus, and seed data).

## Stack

Next.js (App Router, TypeScript) · Tailwind CSS · shadcn/ui · Supabase (Auth via `@supabase/ssr`) · Vitest · ESLint. Deploy target: Vercel.

## Prerequisites

- Node.js 20+ and npm
- A Supabase cloud project (free tier is fine) with the **Email** auth provider enabled
  (Supabase dashboard → Authentication → Sign In / Up → Email)

## Setup

```bash
git clone <this-repo> && cd <this-repo>
npm install
```

1. Copy the env template:

   ```bash
   cp .env.example .env.local        # PowerShell: Copy-Item .env.example .env.local
   ```

2. Paste your Supabase credentials into `.env.local` from the Supabase dashboard
   (Project Settings → API / API Keys). Each variable is documented inline in
   `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` is server-only — never give it a
   `NEXT_PUBLIC` prefix. The Anthropic variables are reserved for Phase 3 and can
   stay as placeholders for now.

3. Run the dev server:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 — you'll be redirected to `/login`. Sign up with an
   email + password, confirm the email if your project requires it, and you'll land
   on the protected `/dashboard`.

## Scripts

| Command               | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `npm run dev`         | Start the dev server                                       |
| `npm run build`       | Production build (works without creds)                     |
| `npm start`           | Serve the production build                                 |
| `npm run lint`        | ESLint (next core-web-vitals)                              |
| `npm test`            | Vitest — unit tests plus a live RLS isolation test that    |
|                       | auto-skips when `.env.local` has no credentials            |
| `npm run db:link`     | Link the repo to your cloud Supabase project               |
| `npm run db:push`     | Apply `supabase/migrations/` to the cloud database         |
| `npm run db:types`    | Regenerate `src/lib/database.types.ts` from the live schema |
| `npm run db:advisors` | Run Supabase security/performance advisors                 |
| `npm run seed`        | Seed the first user's org with sample niches/assets/opportunities (idempotent; rows marked `[SEED]`) |

## Database (Phase 1)

The schema lives in `supabase/migrations/` — 11 org-scoped tables (organizations,
org_members, niches, opportunities, proposals, deals, clients, assets, delivery_jobs,
contractors, audit_events) plus a client-LTV reporting view.

- **RLS on every table**: rows are only visible to members of the owning org
  (verified by `src/lib/supabase/rls.integration.test.ts` against the live DB).
- **audit_events is append-only** — no UPDATE/DELETE for app users; every proposal
  approval/send will be recorded here (Phase 4).
- **assets.embedding** is a pgvector column for the RAG corpus; embeddings and the
  vector index arrive in Phase 4.
- **Signup trigger**: every new auth user automatically gets a personal organization
  (single-operator default; multi-seat comes later).

First-time setup after pasting credentials: `npm run db:link && npm run db:push`,
sign up at `/login`, then `npm run seed`.

## Ingestion (Phase 2)

Four compliant channels feed the `opportunities` queue; every one flows through
a single pipeline (`src/lib/ingestion/create-opportunity.ts`) that normalizes,
**dedups** (unique on external ref, content-hash fallback otherwise), inserts,
and enqueues an async `score_opportunity` job in `job_queue` (Phase 3 consumes it).

| Channel | Endpoint | Auth |
| --- | --- | --- |
| Marketplace read API | `POST /api/ingest/marketplace/poll` | `Authorization: Bearer $CRON_SECRET` (called by a scheduler) |
| Alert emails | `POST /api/ingest/email` | `X-Ingest-Secret: $INGEST_EMAIL_SECRET` (called by your inbound-email forwarder) |
| Owned inbound (your funnels) | `POST /api/ingest/inbound` | `X-Ingest-Token: $INGEST_FORM_TOKEN` + honeypot field |
| Outbound import (CSV/JSON) | `POST /api/import/outbound` | Signed-in session (org-scoped) |

**Alert emails:** configure job alerts inside the marketplace yourself, forward
them (Cloudflare Email Workers / Mailgun / SendGrid inbound parse) as JSON
`{ subject, text }` to `/api/ingest/email`. The parser is provider-agnostic and
tested against `src/lib/ingestion/__fixtures__/sample-alert-email.txt`.

**Outbound import:** `POST` a CSV (`content-type: text/csv`; header row
`company,title,description,budget,currency,url,niche,ref`) or a JSON array of
the same fields.

## AI scoring (Phase 3)

Every ingested opportunity gets an async `score_opportunity` job. The worker
(`src/lib/scoring/worker.ts`) claims jobs atomically (`claim_queue_jobs`,
SKIP LOCKED), calls Claude server-side with **structured outputs** (strict
JSON schema; ranges re-validated in code), stores `fit / margin_potential /
urgency / effort` (0–100) plus a one-line rationale on the opportunity, and
retries failures with exponential backoff up to `max_attempts`.

- **Model** comes from `ANTHROPIC_MODEL` (server-side only; default
  `claude-opus-4-8`). Requires a funded Anthropic account.
- **Ranked queue UI** at `/opportunities`: composite score =
  weighted(fit, margin, urgency, 100−effort), re-weightable per org and saved
  on the organization's settings. "Run scoring now" processes pending jobs
  in-app; deployed on Vercel, the cron in `vercel.json` hits
  `GET /api/jobs/run` every 10 minutes (Vercel sends `Authorization: Bearer
  $CRON_SECRET` automatically when the env var is set).

## Proposal engine (Phase 4)

From the opportunity queue, **Draft** retrieves the most relevant corpus
assets and has Claude write a grounded, referenced proposal in your voice —
saved as `proposals.draft`, never sent. You edit the **final** text at
`/proposals/[id]`, then the gate:

> **Approve & mark sent** is the ONLY path to `status = 'sent'`. It requires a
> signed-in human, stamps `approved_by` + `sent_at`, and writes an append-only
> `audit_events` row. ForgeOS never transmits proposals to any marketplace or
> third party — "sent" records that *you* sent it yourself. A static
> compliance test (`src/lib/proposals/no-auto-send.test.ts`) fails the suite
> if any other code path ever writes `sent` or if automated surfaces touch
> the proposals table.

Afterwards, record the **outcome** (reply / shortlisted / won / lost /
no-response); "won" automatically files the final text back into the RAG
corpus as a `winning_proposal` asset, so future drafts learn from wins.

**Retrieval:** with `EMBEDDINGS_PROVIDER` configured (voyage or openai) and
`npm run embed` run, drafts ground on cosine-matched assets via pgvector;
without it, a deterministic type-aware fallback picks niche-matched case
studies, winning proposals, your pricing framework, and tone sample — so
drafting works with no extra accounts.

### Marketplace API compliance note (read before enabling)

The marketplace adapter (`src/lib/ingestion/marketplace/adapter.ts`) uses
**official, documented READ APIs only**, is disabled by default, and is fully
inert unless `MARKETPLACE_API_ENABLED=true` **and** `MARKETPLACE_API_KEY` are
set. Enabling it for a specific marketplace requires that marketplace's
approved API access (e.g. an approved API application) and compliance with its
terms of service. **This codebase contains no scraping, crawling, or
headless-browser machinery — and a compliance test
(`src/lib/ingestion/compliance.test.ts`) fails the suite if such a dependency
is ever added.** The system never submits proposals or takes any action on a
marketplace on your behalf.

## Project layout

```
supabase/
  migrations/       # schema as SQL migrations (applied with npm run db:push)
scripts/
  db.mjs            # Supabase CLI wrapper (reads .env.local; link/push/types)
  seed.mjs          # idempotent seed: 2 niches, 4 RAG assets, 4 opportunities
src/
  app/
    login/          # email+password sign-in / sign-up
    dashboard/      # protected; server-side session check
    page.tsx        # / → redirects to /dashboard
  components/ui/    # shadcn/ui components
  lib/
    env.ts          # runtime validation of required public env vars
    database.types.ts  # generated from the live schema (npm run db:types)
    supabase/
      client.ts     # browser client (anon key only)
      server.ts     # server client (@supabase/ssr cookie handling)
      admin.ts      # service-role client — import "server-only"
      proxy.ts      # session refresh + route protection helper
      rls.integration.test.ts  # live cross-org isolation proof
  proxy.ts          # Next.js proxy entry (Next 16 renamed middleware → proxy)
```

## Phases

Development proceeds in phases. **Phase 0 (scaffold, auth, env wiring) and
Phase 1 (data model + RLS + seed) are complete.** Later phases add ingestion,
AI scoring, the proposal engine, pipeline UI, delivery orchestration, and
reporting; the Claude API integration starts in Phase 3 (env vars are already
reserved in `.env.example`).
