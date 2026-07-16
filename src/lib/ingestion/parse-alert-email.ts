/**
 * Parser for marketplace job-alert emails the OPERATOR configured themselves
 * inside a marketplace (compliance: this is one of the two approved marketplace
 * channels — the system only reads mail that the marketplace chose to send).
 *
 * Provider-agnostic: alert emails from the major freelance marketplaces share
 * a plaintext shape — repeated blocks of a job title, a link, an optional
 * budget line, and a snippet of description. The parser extracts every job
 * block it can find; anything unparseable is skipped, never guessed.
 */

export interface ParsedAlertJob {
  title: string;
  url: string | null;
  budget: number | null;
  currency: string | null;
  description: string | null;
}

const BUDGET_RE =
  /(?:budget|fixed[- ]price|est\.?\s*budget|hourly range)\s*:?\s*(?<cur>[$€£]|usd|eur|gbp|zar)?\s*(?<amount>[\d,]+(?:\.\d{1,2})?)(?:\s*-\s*(?:[$€£])?\s*(?<amountHigh>[\d,]+(?:\.\d{1,2})?))?/i;

const CURRENCY_MAP: Record<string, string> = {
  $: "USD",
  usd: "USD",
  "€": "EUR",
  eur: "EUR",
  "£": "GBP",
  gbp: "GBP",
  zar: "ZAR",
};

function parseBudget(text: string): { budget: number | null; currency: string | null } {
  const m = BUDGET_RE.exec(text);
  if (!m?.groups?.amount) return { budget: null, currency: null };
  // For ranges, take the upper bound — closer to the real ceiling of intent.
  const raw = (m.groups.amountHigh ?? m.groups.amount).replace(/,/g, "");
  const budget = Number.parseFloat(raw);
  const curKey = m.groups.cur?.toLowerCase() ?? "";
  return {
    budget: Number.isFinite(budget) ? budget : null,
    currency: CURRENCY_MAP[curKey] ?? null,
  };
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/;

/**
 * Extract job postings from a plaintext alert email body.
 *
 * Heuristic: a job block starts at a non-empty line that is followed
 * (within the block) by a link. Blocks are separated by blank lines or
 * horizontal rules. Footer/unsubscribe content never contains a job link
 * next to a title-looking line, and is additionally filtered by keyword.
 */
export function parseAlertEmail(bodyText: string): ParsedAlertJob[] {
  if (!bodyText?.trim()) return [];

  const blocks = bodyText
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+|\n[-_=*]{3,}\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const jobs: ParsedAlertJob[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const urlMatch = URL_RE.exec(block);
    const url = urlMatch?.[0] ?? null;

    // First line that isn't a URL/label is the candidate title.
    const title = lines.find(
      (l) =>
        !URL_RE.test(l) &&
        !/^(?:budget|fixed[- ]price|hourly(?:\s+range)?|est\.?\s*budget|posted|skills?|category)\s*:/i.test(
          l,
        ) &&
        l.length >= 8,
    );
    if (!title || !url) continue;

    // Skip footer/boilerplate blocks.
    if (
      /unsubscribe|manage (?:your )?alerts|email preferences|privacy policy|terms of service|why did I get this/i.test(
        block,
      )
    ) {
      continue;
    }

    const { budget, currency } = parseBudget(block);

    // Description: the block minus title, labels, and links.
    const description =
      lines
        .filter(
          (l) =>
            l !== title &&
            !URL_RE.test(l) &&
            !/^(?:posted|skills?|category)\s*:/i.test(l),
        )
        .join(" ")
        .trim() || null;

    jobs.push({ title: title.slice(0, 500), url, budget, currency, description });
  }

  return jobs;
}
