import { NextResponse } from "next/server";

import { exportClientData } from "@/lib/deals/deals";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POPIA affordance: export everything held about a client as JSON.
 * Session-authenticated; org membership scoped.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .limit(1)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "no org membership" }, { status: 403 });
  }

  try {
    const data = await exportClientData({ clientId: id, orgId: membership.org_id });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="client-${id}-export.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }
}
