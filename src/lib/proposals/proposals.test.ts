import { describe, expect, it } from "vitest";

import { buildDraftUserPrompt } from "@/lib/proposals/prompt";
import type { RetrievedAsset } from "@/lib/rag/retrieve";

describe("buildDraftUserPrompt (grounding)", () => {
  const assets: RetrievedAsset[] = [
    {
      id: "a1",
      type: "case_study",
      title: "3,100-ticket backlog cleared in 9 days",
      content: "Backlog cleared in 9 days, CSAT 71% → 92%, 58% gross margin.",
      via: "structured",
    },
    {
      id: "a2",
      type: "tone_sample",
      title: "Operator voice",
      content: "Short sentences. Outcome first. Zero filler.",
      via: "structured",
    },
  ];

  const opportunity = {
    title: "Support team for Shopify store",
    description: "10k tickets/month, Gorgias, US hours.",
    budget: 3500,
    currency: "USD",
    source: "alert_email",
  };

  it("includes every retrieved asset's content verbatim — the draft is grounded", () => {
    const prompt = buildDraftUserPrompt({ niche: null, opportunity, assets });
    expect(prompt).toContain("3,100-ticket backlog cleared in 9 days");
    expect(prompt).toContain("CSAT 71% → 92%");
    expect(prompt).toContain("Short sentences. Outcome first.");
    expect(prompt).toContain("[ASSET 1 — CASE_STUDY]");
    expect(prompt).toContain("[ASSET 2 — TONE_SAMPLE]");
  });

  it("includes the opportunity and niche context", () => {
    const prompt = buildDraftUserPrompt({
      niche: {
        name: "Customer Support Ops",
        pricing_model: "Monthly retainer",
        target_margin: 55,
        positioning_notes: "Support pods for e-commerce.",
      },
      opportunity,
      assets,
    });
    expect(prompt).toContain("Support team for Shopify store");
    expect(prompt).toContain("3500 USD");
    expect(prompt).toContain("Customer Support Ops");
    expect(prompt).toContain("Target margin: 55%");
  });

  it("tells the model to invent nothing when no assets exist", () => {
    const prompt = buildDraftUserPrompt({ niche: null, opportunity, assets: [] });
    expect(prompt).toContain("invent nothing");
  });
});
