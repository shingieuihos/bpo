import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";

/**
 * Supabase ADMIN client (service role). SERVER-ONLY.
 *
 * The `server-only` import above makes any attempt to pull this module into
 * client-side code a build-time error, so the service-role key can never be
 * bundled for the browser.
 *
 * The service-role key bypasses Row Level Security — use this client only for
 * trusted server-side operations, never with user-controlled input deciding
 * what it touches.
 */
export function createAdminClient() {
  const { supabaseUrl } = getPublicEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY. " +
        "Copy .env.example to .env.local and paste the service-role key from " +
        "your Supabase dashboard (Project Settings → API Keys). This key is " +
        "server-only — it must never be given a NEXT_PUBLIC prefix.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
