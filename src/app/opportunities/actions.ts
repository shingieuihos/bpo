"use server";

import { revalidatePath } from "next/cache";

import { DEFAULT_WEIGHTS, type ScoringWeights } from "@/lib/scoring/composite";
import { processScoreJobs } from "@/lib/scoring/worker";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Session + membership check shared by both actions. Returns the org id. */
async function requireOrg(): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) throw new Error("not signed in");

  const { data: membership, error: memberError } = await supabase
    .from("org_members")
    .select("org_id")
    .limit(1)
    .maybeSingle();
  if (memberError || !membership) throw new Error("no org membership");
  return membership.org_id;
}

export async function saveWeights(formData: FormData): Promise<void> {
  const orgId = await requireOrg();

  const clamp = (name: keyof ScoringWeights) => {
    const v = Number.parseInt(String(formData.get(name) ?? ""), 10);
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : DEFAULT_WEIGHTS[name];
  };
  const weights: ScoringWeights = {
    fit: clamp("fit"),
    margin: clamp("margin"),
    urgency: clamp("urgency"),
    effort: clamp("effort"),
  };
  if (weights.fit + weights.margin + weights.urgency + weights.effort <= 0) {
    throw new Error("at least one weight must be positive");
  }

  // organizations has no client UPDATE grant (by design) — the write happens
  // with the service role AFTER the membership check above.
  const admin = createAdminClient();
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .single();
  if (orgError) throw new Error("failed to load org settings");

  const settings = {
    ...(typeof org.settings === "object" && org.settings !== null && !Array.isArray(org.settings)
      ? org.settings
      : {}),
    scoring_weights: {
      fit: weights.fit,
      margin: weights.margin,
      urgency: weights.urgency,
      effort: weights.effort,
    },
  };
  const { error: updateError } = await admin
    .from("organizations")
    .update({ settings })
    .eq("id", orgId);
  if (updateError) throw new Error("failed to save weights");

  revalidatePath("/opportunities");
}

export async function runScoringNow(): Promise<void> {
  const orgId = await requireOrg();
  await processScoreJobs({ limit: 10, orgId });
  revalidatePath("/opportunities");
}
