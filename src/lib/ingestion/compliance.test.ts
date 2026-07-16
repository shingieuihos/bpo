import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Compliance guard — these tests fail the build if anyone ever tries to add
 * scraping machinery to this codebase. See "NON-NEGOTIABLE PRINCIPLES" in
 * agency-pipeline-build-prompt.md and AGENTS.md: marketplace data enters only
 * via official read APIs or operator-configured alert emails. No scraping,
 * no headless browsers, no marketplace automation. Ever.
 */
describe("compliance: no scraping toolchain", () => {
  const FORBIDDEN_DEPS = [
    "puppeteer",
    "puppeteer-core",
    "playwright",
    "playwright-core",
    "selenium-webdriver",
    "cheerio",
    "jsdom",
    "phantomjs",
    "phantomjs-prebuilt",
    "crawlee",
    "scrape-it",
    "node-html-parser",
  ];

  it("package.json contains no scraping/headless-browser dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    const all = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }).map((d) => d.toLowerCase());

    for (const forbidden of FORBIDDEN_DEPS) {
      expect(all, `forbidden dependency present: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("marketplace adapter is inert without feature flag + credentials", async () => {
    delete process.env.MARKETPLACE_API_ENABLED;
    delete process.env.MARKETPLACE_API_KEY;
    const { getMarketplaceAdapter } = await import(
      "@/lib/ingestion/marketplace/adapter"
    );
    const adapter = getMarketplaceAdapter();
    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.fetchJobs({ limit: 10 })).resolves.toEqual([]);
  });

  it("flag alone (without credentials) still leaves the adapter inert", async () => {
    process.env.MARKETPLACE_API_ENABLED = "true";
    delete process.env.MARKETPLACE_API_KEY;
    const { getMarketplaceAdapter } = await import(
      "@/lib/ingestion/marketplace/adapter"
    );
    const adapter = getMarketplaceAdapter();
    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.fetchJobs({ limit: 10 })).resolves.toEqual([]);
    delete process.env.MARKETPLACE_API_ENABLED;
  });
});
