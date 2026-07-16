import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPublicEnv, missingPublicEnv } from "@/lib/env";

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

describe("missingPublicEnv", () => {
  it("reports every required variable when nothing is set", () => {
    expect(missingPublicEnv({})).toEqual([URL_KEY, ANON_KEY]);
  });

  it("treats empty strings as missing", () => {
    expect(
      missingPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      }),
    ).toEqual([URL_KEY, ANON_KEY]);
  });

  it("reports only the variables that are actually missing", () => {
    expect(
      missingPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toEqual([ANON_KEY]);
  });

  it("returns an empty list when everything is present", () => {
    expect(
      missingPublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
      }),
    ).toEqual([]);
  });
});

describe("getPublicEnv", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved[URL_KEY] = process.env[URL_KEY];
    saved[ANON_KEY] = process.env[ANON_KEY];
    delete process.env[URL_KEY];
    delete process.env[ANON_KEY];
  });

  afterEach(() => {
    for (const key of [URL_KEY, ANON_KEY]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("throws a clear, actionable error naming the missing variables", () => {
    expect(() => getPublicEnv()).toThrowError(
      new RegExp(`${URL_KEY}.*${ANON_KEY}`),
    );
    expect(() => getPublicEnv()).toThrowError(/\.env\.example/);
  });

  it("names only the variable that is missing", () => {
    process.env[URL_KEY] = "https://example.supabase.co";
    expect(() => getPublicEnv()).toThrowError(new RegExp(ANON_KEY));
    expect(() => getPublicEnv()).not.toThrowError(new RegExp(`${URL_KEY},`));
  });

  it("returns the values when both variables are set", () => {
    process.env[URL_KEY] = "https://example.supabase.co";
    process.env[ANON_KEY] = "public-anon-key";
    expect(getPublicEnv()).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-anon-key",
    });
  });
});
