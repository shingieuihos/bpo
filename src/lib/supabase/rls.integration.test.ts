/**
 * RLS isolation test — Phase 1 acceptance: "a query from one org cannot read
 * another org's rows."
 *
 * Runs against the LIVE linked Supabase project using credentials from
 * .env.local; the whole suite is skipped when credentials are absent (CI).
 * It provisions two throwaway users (the signup trigger gives each a personal
 * org), inserts a niche into each org, then proves via the anon-key Data API:
 *   1. each user sees exactly their own org's rows,
 *   2. cross-org INSERT is rejected by RLS,
 *   3. audit_events is append-only for authenticated users,
 * and cleans everything up afterwards.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/database.types";

function loadEnvLocal(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => [
          l.slice(0, l.indexOf("=")).trim(),
          l.slice(l.indexOf("=") + 1).trim(),
        ]),
    );
  } catch {
    return {};
  }
}

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const haveCreds = Boolean(url && anonKey && serviceKey);

const TIMEOUT = 30_000;

describe.skipIf(!haveCreds)("RLS org isolation (live database)", () => {
  const admin = createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  type TestActor = {
    userId: string;
    email: string;
    password: string;
    orgId: string;
    client: SupabaseClient<Database>;
  };
  const actors: TestActor[] = [];

  async function createActor(tag: string): Promise<TestActor> {
    const email = `rls-${tag}-${crypto.randomUUID()}@example.com`;
    const password = `Rls!${crypto.randomUUID()}`;

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    if (createError) throw createError;
    const userId = created.user.id;

    // The signup trigger provisions a personal org; find it.
    const { data: membership, error: memberError } = await admin
      .from("org_members")
      .select("org_id")
      .eq("user_id", userId)
      .single();
    if (memberError) throw memberError;

    const client = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;

    return { userId, email, password, orgId: membership.org_id, client };
  }

  beforeAll(async () => {
    actors.push(await createActor("a"), await createActor("b"));

    // Insert one niche per org (as service role, bypassing RLS).
    for (const [i, actor] of actors.entries()) {
      const { error } = await admin.from("niches").insert({
        org_id: actor.orgId,
        name: `RLS probe niche ${i}`,
        positioning_notes: "test row — cleaned up by rls.integration.test.ts",
      });
      if (error) throw error;
    }
  }, TIMEOUT);

  afterAll(async () => {
    for (const actor of actors) {
      await admin.from("organizations").delete().eq("id", actor.orgId);
      await admin.auth.admin.deleteUser(actor.userId);
    }
  }, TIMEOUT);

  it(
    "signup trigger provisioned distinct personal orgs",
    () => {
      expect(actors[0].orgId).toBeTruthy();
      expect(actors[1].orgId).toBeTruthy();
      expect(actors[0].orgId).not.toBe(actors[1].orgId);
    },
    TIMEOUT,
  );

  it(
    "each user reads ONLY their own org's niches",
    async () => {
      const [a, b] = actors;

      const { data: aRows, error: aError } = await a.client
        .from("niches")
        .select("org_id");
      expect(aError).toBeNull();
      expect(aRows!.length).toBeGreaterThan(0);
      expect(aRows!.every((r) => r.org_id === a.orgId)).toBe(true);

      const { data: bRows, error: bError } = await b.client
        .from("niches")
        .select("org_id");
      expect(bError).toBeNull();
      expect(bRows!.length).toBeGreaterThan(0);
      expect(bRows!.every((r) => r.org_id === b.orgId)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "cannot read another org's organization row",
    async () => {
      const [a, b] = actors;
      const { data, error } = await a.client
        .from("organizations")
        .select("id")
        .eq("id", b.orgId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    },
    TIMEOUT,
  );

  it(
    "cross-org INSERT is rejected by RLS",
    async () => {
      const [a, b] = actors;
      const { error } = await a.client.from("niches").insert({
        org_id: b.orgId,
        name: "cross-org write attempt",
      });
      expect(error).not.toBeNull();
      // Postgres RLS violation surfaces as 42501 (insufficient privilege).
      expect(error!.code).toBe("42501");
    },
    TIMEOUT,
  );

  it(
    "audit_events is append-only: INSERT allowed, UPDATE/DELETE blocked",
    async () => {
      const [a] = actors;
      const { data: inserted, error: insertError } = await a.client
        .from("audit_events")
        .insert({
          org_id: a.orgId,
          actor: a.userId,
          action: "rls.test",
          entity_type: "test",
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();

      const { error: updateError } = await a.client
        .from("audit_events")
        .update({ action: "rls.tampered" })
        .eq("id", inserted!.id);
      expect(updateError).not.toBeNull();

      const del = await a.client
        .from("audit_events")
        .delete()
        .eq("id", inserted!.id)
        .select("id");
      // Blocked either loudly (error) or silently (0 rows affected).
      expect(del.error !== null || del.data?.length === 0).toBe(true);

      // Row must still exist (verified as service role).
      const { data: still } = await admin
        .from("audit_events")
        .select("action")
        .eq("id", inserted!.id)
        .single();
      expect(still?.action).toBe("rls.test");
    },
    TIMEOUT,
  );
});

describe.skipIf(haveCreds)("RLS org isolation (skipped)", () => {
  it("skipped: no Supabase credentials in .env.local", () => {
    expect(haveCreds).toBe(false);
  });
});
