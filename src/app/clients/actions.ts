"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const CLASSIFICATIONS = ["general", "personal_data", "special_personal_data"] as const;
type Classification = (typeof CLASSIFICATIONS)[number];

function isClassification(v: string): v is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(v);
}

export async function updateClientDetails(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "");
  const classification = String(formData.get("data_classification") ?? "");
  if (!clientId || !isClassification(classification)) throw new Error("invalid input");

  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const contact: Record<string, string> = {};
  if (email) contact.email = email;
  if (phone) contact.phone = phone;

  // Authed client → RLS enforces org scope.
  const supabase = await createClient();
  const { error } = await supabase
    .from("clients")
    .update({
      name: String(formData.get("name") ?? "").trim() || undefined,
      contact,
      notes: String(formData.get("notes") ?? "").trim() || null,
      data_classification: classification,
    })
    .eq("id", clientId);
  if (error) throw new Error("client update failed");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/clients");
}

/**
 * POPIA affordance: delete a client's record. Deals keep their financials
 * (client_id nulls out via FK), the client row and its PII are removed.
 * The UI gates this behind an explicit confirmation phrase.
 */
export async function deleteClientRecord(formData: FormData): Promise<void> {
  const clientId = String(formData.get("client_id") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (!clientId) throw new Error("missing client");
  if (confirmation !== "DELETE") {
    throw new Error('type DELETE in the confirmation box to remove this client');
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clients").delete().eq("id", clientId);
  if (error) throw new Error("client deletion failed");
  revalidatePath("/clients");
  redirect("/clients");
}
