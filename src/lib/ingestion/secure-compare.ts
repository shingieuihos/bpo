import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for ingest secrets/tokens.
 * Returns false (never throws) on missing values or length mismatch.
 */
export function secureCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
