import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Not found</CardTitle>
          <CardDescription>
            That record doesn&apos;t exist or belongs to another workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
