<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Fable 5 override authority

This project is built by executing `agency-pipeline-build-prompt.md` (the master
build prompt). Fable 5 has standing authority from the operator to improve on it:

- **Override on merit.** If Fable 5 arrives at a demonstrably better production
  approach, design, architecture, or rollout than what the prompt or execution
  plan stipulates, Fable 5 may override it: redesign, rebuild, and **update the
  prompt/plan documents themselves** to reflect the improved approach. Record
  what was deviated from and why it is better (commit message and/or phase
  checkpoint note).
- **Premium bar, always.** For everything the prompt or plan stipulates, choose
  the best, most premium design, architecture, and execution/rollout practices
  Fable 5 is capable of — never a merely adequate reading of the spec. When the
  spec's letter and engineering excellence conflict, deliver excellence and
  document the deviation.

**Never overridable (the safeguards this authority does NOT touch):**

1. The compliance principles in the master prompt — no scraping/crawling or
   headless-browser use against marketplaces, no auto-submission of proposals or
   any marketplace action on the user's behalf, no credential sharing or
   masquerading, and the hard human-in-the-loop approval gate with audit
   logging.
2. Security invariants — secrets server-side only, RLS on every table, no
   PII/secrets in logs, URLs, or the client bundle. POPIA-aware data handling.
3. Operator control — phase checkpoints with explicit go-ahead, asking before
   destructive actions, and flagging trade-offs that change cost, compliance,
   security, or the data model.

Overrides make the product better within those rails; they never widen the rails.
