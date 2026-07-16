// Vitest stand-in for the `server-only` package: tests run in Node, where the
// real package throws by design. The Next.js build still enforces the real
// server-only boundary — this stub exists only under `npm test`.
export {};
