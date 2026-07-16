import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const [{ data: clients }, { data: ltv }] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, data_classification, first_won_at, contact")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("v_client_lifetime_value").select("client_id, lifetime_value, won_deals"),
  ]);
  const ltvByClient = new Map(
    (ltv ?? []).map((row) => [row.client_id, row]),
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-muted-foreground">
            Won relationships, their lifetime value, and POPIA data classification.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/pipeline">Pipeline</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[35%]">Client</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>First won</TableHead>
                <TableHead className="text-right">Lifetime value</TableHead>
                <TableHead className="text-right">Won deals</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(clients ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No clients yet — win a deal in the pipeline.
                  </TableCell>
                </TableRow>
              )}
              {(clients ?? []).map((c) => {
                const stats = ltvByClient.get(c.id);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.data_classification === "general" ? "outline" : "secondary"
                        }
                      >
                        {c.data_classification.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.first_won_at ? new Date(c.first_won_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {Number(stats?.lifetime_value ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">{stats?.won_deals ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/clients/${c.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
