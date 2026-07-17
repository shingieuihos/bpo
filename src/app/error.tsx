"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            {error.message || "An unexpected error occurred."} Nothing was sent
            anywhere — retry or head back.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
            Dashboard
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
