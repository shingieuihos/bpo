import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { SignOutButton } from "./sign-out-button";

// Reads the user's session from cookies — must render per-request, never at
// build time (also lets `next build` pass without Supabase credentials).
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  // getClaims() verifies the auth token; never trust getSession() in server
  // code. The proxy already guards this route — this is defense in depth.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/login");
  }

  const email =
    typeof data.claims.email === "string" ? data.claims.email : "unknown";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>ForgeOS — Phase 0</CardTitle>
          <CardDescription>
            Scaffold complete. Business features arrive in later phases.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <Button asChild>
              <Link href="/opportunities">Opportunities</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/proposals">Proposals</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/pipeline">Pipeline</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/clients">Clients</Link>
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="font-medium">{email}</span>
            </p>
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
