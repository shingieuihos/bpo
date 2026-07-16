import Link from "next/link";
import { redirect } from "next/navigation";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseTasks } from "@/lib/delivery/tasks";
import { createClient } from "@/lib/supabase/server";

import { addContractor } from "./actions";

export const dynamic = "force-dynamic";

export default async function DeliveryIndexPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const [{ data: jobs }, { data: contractors }] = await Promise.all([
    supabase
      .from("delivery_jobs")
      .select("id, status, qa_status, tasks, created_at, deals (opportunities (title))")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("contractors").select("id, name, skills, rate, currency").order("name"),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Delivery</h1>
          <p className="text-sm text-muted-foreground">
            Jobs spawn from won deals; the QA gate stands between work and “delivered”.
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
                <TableHead className="w-[45%]">Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>QA</TableHead>
                <TableHead>Tasks</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(jobs ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No delivery jobs yet — win a deal, then create one from its page.
                  </TableCell>
                </TableRow>
              )}
              {(jobs ?? []).map((j) => {
                const tasks = parseTasks(j.tasks);
                return (
                  <TableRow key={j.id}>
                    <TableCell className="font-medium">
                      {j.deals?.opportunities?.title ?? "Job"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={j.status === "delivered" ? "default" : "secondary"}>
                        {j.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          j.qa_status === "passed"
                            ? "default"
                            : j.qa_status === "rework"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {j.qa_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tasks.filter((t) => t.status === "done").length}/{tasks.length}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/delivery/${j.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contractors</CardTitle>
          <CardDescription>
            The human side of delivery — tasks route to them or to AI first-drafts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(contractors ?? []).length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              {(contractors ?? []).map((c) => (
                <div key={c.id} className="flex items-center justify-between">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">
                    {c.skills.join(", ") || "—"}
                    {c.rate != null && ` · ${c.rate} ${c.currency}/h`}
                  </span>
                </div>
              ))}
            </div>
          )}
          <form action={addContractor} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Jane Doe" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skills">Skills (comma-separated)</Label>
              <Input id="skills" name="skills" placeholder="support, data entry" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rate">Rate/h</Label>
              <Input id="rate" name="rate" type="number" step="0.01" className="w-24" />
            </div>
            <Button type="submit" variant="secondary">
              Add contractor
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
