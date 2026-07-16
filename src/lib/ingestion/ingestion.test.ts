import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { computeDedupKey } from "@/lib/ingestion/dedup";
import { parseCsv } from "@/lib/ingestion/csv";
import { parseAlertEmail } from "@/lib/ingestion/parse-alert-email";
import { secureCompare } from "@/lib/ingestion/secure-compare";

describe("parseAlertEmail", () => {
  const fixture = readFileSync(
    join(__dirname, "__fixtures__", "sample-alert-email.txt"),
    "utf8",
  );

  it("extracts every job from a realistic alert email", () => {
    const jobs = parseAlertEmail(fixture);
    expect(jobs).toHaveLength(3);

    expect(jobs[0].title).toBe(
      "Customer support agents needed for growing Shopify store",
    );
    expect(jobs[0].url).toBe(
      "https://www.example-marketplace.com/jobs/~021845723901",
    );
    // Range "$2,500 - $4,000" → upper bound.
    expect(jobs[0].budget).toBe(4000);
    expect(jobs[0].currency).toBe("USD");

    expect(jobs[1].title).toBe(
      "Virtual assistant team for data entry and CRM cleanup",
    );
    expect(jobs[1].budget).toBe(800);

    expect(jobs[2].title).toBe(
      "Lead list building for B2B fintech — compliance officers EMEA",
    );
    expect(jobs[2].budget).toBe(12);
  });

  it("never turns footer/unsubscribe content into a job", () => {
    const jobs = parseAlertEmail(fixture);
    for (const job of jobs) {
      expect(job.title.toLowerCase()).not.toContain("unsubscribe");
      expect(job.url).not.toContain("unsubscribe");
      expect(job.url).not.toContain("/alerts/");
    }
  });

  it("returns [] for empty or linkless content", () => {
    expect(parseAlertEmail("")).toEqual([]);
    expect(parseAlertEmail("Hello,\n\nJust checking in.\n")).toEqual([]);
  });
});

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes, embedded commas and newlines", () => {
    const csv =
      'company,title,description,budget\n' +
      '"Acme, Inc.","VA team","Needs ""daily"" updates\nacross timezones",1200\n' +
      "Beta LLC,Support pod,Simple row,800\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].company).toBe("Acme, Inc.");
    expect(rows[0].description).toBe('Needs "daily" updates\nacross timezones');
    expect(rows[1].budget).toBe("800");
  });

  it("returns [] when there is no data row", () => {
    expect(parseCsv("company,title\n")).toEqual([]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("computeDedupKey", () => {
  it("is stable under case/whitespace/trailing-slash noise", () => {
    const a = computeDedupKey({
      source: "owned_inbound",
      title: "Inbound: Acme — support help",
      url: "https://acme.com/contact/",
      budget: 1000,
    });
    const b = computeDedupKey({
      source: "owned_inbound",
      title: "  inbound:   acme — SUPPORT help ",
      url: "HTTPS://ACME.COM/CONTACT",
      budget: 1000,
    });
    expect(a).toBe(b);
  });

  it("differs when content differs", () => {
    const base = { source: "outbound", title: "Prospect: Acme", url: null, budget: null };
    expect(computeDedupKey(base)).not.toBe(
      computeDedupKey({ ...base, title: "Prospect: Beta" }),
    );
  });
});

describe("secureCompare", () => {
  it("matches equal strings and rejects everything else", () => {
    expect(secureCompare("secret-token", "secret-token")).toBe(true);
    expect(secureCompare("secret-token", "secret-tokeN")).toBe(false);
    expect(secureCompare("short", "longer-value")).toBe(false);
    expect(secureCompare(null, "x")).toBe(false);
    expect(secureCompare("x", undefined)).toBe(false);
  });
});
