"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
import { createClient } from "@/lib/supabase/client";

type Pending = "sign-in" | "sign-up" | null;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending("sign-in");
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  }

  async function signUp() {
    setError(null);
    setNotice(null);
    if (!email || !password) {
      setError("Enter an email and password, then click Sign up.");
      return;
    }
    setPending("sign-up");
    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (data.session) {
        // Email confirmation disabled in the Supabase project — signed in.
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setNotice(
        "Account created. Check your inbox for a confirmation email, then sign in.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>ForgeOS</CardTitle>
          <CardDescription>
            Sign in with your email and password, or create an account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={signIn} className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {notice ? <p className="text-sm">{notice}</p> : null}
            <div className="flex flex-col gap-2">
              <Button type="submit" disabled={pending !== null}>
                {pending === "sign-in" ? "Signing in…" : "Sign in"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending !== null}
                onClick={signUp}
              >
                {pending === "sign-up" ? "Creating account…" : "Sign up"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
