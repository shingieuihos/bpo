# ForgeOS

ForgeOS is the internal platform for running an AI-assisted agency/BPO business — client work, delivery pipelines, and operations in one place.
Built in phases; this repo currently contains **Phase 0**: the authenticated application shell (no business logic yet).

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

| Command         | What it does                            |
| --------------- | --------------------------------------- |
| `npm run dev`   | Start the dev server                    |
| `npm run build` | Production build (works without creds)  |
| `npm start`     | Serve the production build              |
| `npm run lint`  | ESLint (next core-web-vitals)           |
| `npm test`      | Vitest (runs without Supabase creds)    |

## Project layout (Phase 0)

```
src/
  app/
    login/          # email+password sign-in / sign-up
    dashboard/      # protected; server-side session check
    page.tsx        # / → redirects to /dashboard
  components/ui/    # shadcn/ui components
  lib/
    env.ts          # runtime validation of required public env vars
    supabase/
      client.ts     # browser client (anon key only)
      server.ts     # server client (@supabase/ssr cookie handling)
      admin.ts      # service-role client — import "server-only"
      middleware.ts # session refresh + route protection helper
  middleware.ts     # Next.js middleware entry
```

## Phases

Development proceeds in phases. **Phase 0 (this): scaffold, auth, env wiring — complete.**
Later phases add the business features; the Claude API integration starts in Phase 3
(env vars are already reserved in `.env.example`).
