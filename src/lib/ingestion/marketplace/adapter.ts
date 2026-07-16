import "server-only";

import type { ParsedAlertJob } from "@/lib/ingestion/parse-alert-email";

/**
 * COMPLIANCE CONTRACT — read before touching this file.
 *
 * Marketplace data enters ForgeOS through exactly two doors:
 *   (a) official, approved READ APIs — implemented behind this interface,
 *   (b) job-alert emails the operator configured inside the marketplace
 *       (handled separately by the /api/ingest/email endpoint).
 *
 * An adapter may only call documented, authenticated, official API endpoints
 * that the marketplace offers for programmatic READ access, subject to that
 * marketplace's terms and (where required) an approved API application.
 *
 * FORBIDDEN, permanently: scraping or crawling marketplace pages, headless
 * browsers, parsing marketplace HTML, impersonating a user session, and any
 * WRITE action (submitting proposals, bidding, spending credits). There is no
 * scraping fallback — an unconfigured adapter does nothing.
 */
export interface MarketplaceAdapter {
  /** Stable identifier, e.g. "official_api". */
  readonly id: string;
  /** True only when the feature flag is on AND credentials are present. */
  isConfigured(): boolean;
  /**
   * Fetch recent job postings from the official READ API.
   * MUST return [] (never throw) when unconfigured — the adapter is inert.
   */
  fetchJobs(params: { query?: string; limit?: number }): Promise<ParsedAlertJob[]>;
}

/**
 * Stub adapter for an official marketplace read API.
 *
 * Inert by design until BOTH env vars are set:
 *   MARKETPLACE_API_ENABLED=true  — the feature flag
 *   MARKETPLACE_API_KEY=...       — credentials for the official API
 *
 * The fetch implementation lands only when the operator has an approved
 * official API application for a specific marketplace (see README note);
 * the interface and wiring are ready so that drop-in is a small, reviewed
 * change rather than a rework.
 */
export class OfficialApiAdapter implements MarketplaceAdapter {
  readonly id = "official_api";

  isConfigured(): boolean {
    return (
      process.env.MARKETPLACE_API_ENABLED === "true" &&
      Boolean(process.env.MARKETPLACE_API_KEY)
    );
  }

  async fetchJobs(): Promise<ParsedAlertJob[]> {
    if (!this.isConfigured()) return [];
    // Implementation lands with an approved official API application.
    // It must call documented READ endpoints only — see the compliance
    // contract at the top of this file.
    console.warn(
      "OfficialApiAdapter: enabled but no marketplace API implementation is installed yet; returning [].",
    );
    return [];
  }
}

export function getMarketplaceAdapter(): MarketplaceAdapter {
  return new OfficialApiAdapter();
}
