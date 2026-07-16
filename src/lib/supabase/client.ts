import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";

/**
 * Supabase client for the browser (Client Components).
 * Uses ONLY the public URL + anon key — never the service-role key.
 */
export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
