/**
 * Environment variable validation for ForgeOS.
 *
 * Public (browser-safe) variables are validated lazily at runtime — never at
 * build time — so `next build` succeeds without credentials and a missing
 * variable produces one clear, actionable error when the app actually runs.
 *
 * Server-only secrets (the Supabase service-role key, the Anthropic API key)
 * are NOT read here; they are read only inside server-only modules.
 */

export interface PublicEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/**
 * Pure helper: given candidate values, return the names of required public
 * variables that are missing or empty. Exported for unit testing.
 */
export function missingPublicEnv(values: {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}): string[] {
  const missing: string[] = [];
  if (!values.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!values.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return missing;
}

/**
 * Read and validate the required public env vars.
 *
 * The `process.env.NEXT_PUBLIC_*` references below are literal on purpose:
 * Next.js inlines them into the client bundle at build time. Do not replace
 * them with dynamic lookups.
 */
export function getPublicEnv(): PublicEnv {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  const missing = missingPublicEnv(values);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Copy .env.example to .env.local and paste the values from your " +
        "Supabase dashboard (Project Settings → API), then restart the dev server.",
    );
  }

  return {
    supabaseUrl: values.NEXT_PUBLIC_SUPABASE_URL as string,
    supabaseAnonKey: values.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  };
}
