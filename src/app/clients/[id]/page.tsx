import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";

import { deleteClientRecord, updateClientDetails } from "../actions";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const [{ data: client }, { data: deals }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("deals")
      .select("id, stage, value, currency, gross_margin, created_at, opportunities (title)")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!client) notFound();

  const contact = (client.contact ?? {}) as { email?: string; phone?: string };
  const wonValue = (deals ?? [])
    .filter((d) => d.stage === "won")
    .reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{client.name}</h1>
            <Badge variant="secondary">
              {client.data_classification.replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {client.first_won_at
              ? `Client since ${new Date(client.first_won_at).toLocaleDateString()}`
              : "No won deal yet"}{" "}
            · lifetime value {wonValue.toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href={`/api/clients/${client.id}/export`}>Export data</a>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/clients">All clients</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
          <CardDescription>
            Classification drives POPIA handling — client contact records default
            to personal data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateClientDetails} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="client_id" value={client.id} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={client.name} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="data_classification">Data classification</Label>
              <select
                id="data_classification"
                name="data_classification"
                defaultValue={client.data_classification}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="general">general</option>
                <option value="personal_data">personal data</option>
                <option value="special_personal_data">special personal data</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={contact.phone ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" name="notes" defaultValue={client.notes ?? ""} />
            </div>
            <Button type="submit" variant="secondary" className="w-fit">
              Save
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deal history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(deals ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No deals linked yet.</p>
          )}
          {(deals ?? []).map((d) => (
            <div key={d.id} className="flex items-center justify-between text-sm">
              <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                {d.opportunities?.title ?? "Deal"}
              </Link>
              <span className="flex items-center gap-3 text-muted-foreground">
                {d.value != null && `${Number(d.value).toLocaleString()} ${d.currency}`}
                <Badge variant={d.stage === "won" ? "default" : "secondary"}>{d.stage}</Badge>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">Delete client data</CardTitle>
          <CardDescription>
            POPIA affordance: removes this client record and its personal data.
            Deals remain for financial history with the client detached. Type
            DELETE to confirm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={deleteClientRecord} className="flex items-end gap-3">
            <input type="hidden" name="client_id" value={client.id} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmation">Confirmation</Label>
              <Input id="confirmation" name="confirmation" placeholder="DELETE" className="w-36" />
            </div>
            <Button type="submit" variant="destructive">
              Delete client
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
