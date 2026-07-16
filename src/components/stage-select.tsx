"use client";

import { useRef } from "react";

/**
 * Quick stage change: a native select that submits its form on change.
 * ('won' is intentionally absent — winning requires the client flow on the
 * deal page; 'lost' asks for confirmation.)
 */
export function StageSelect({
  dealId,
  stage,
  action,
}: {
  dealId: string;
  stage: string;
  action: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="deal_id" value={dealId} />
      <select
        name="stage"
        defaultValue={stage}
        disabled={stage === "won"}
        className="h-8 rounded-md border bg-background px-2 text-xs"
        onChange={(e) => {
          if (
            e.target.value === "lost" &&
            !window.confirm("Mark this deal as lost?")
          ) {
            e.target.value = stage;
            return;
          }
          formRef.current?.requestSubmit();
        }}
      >
        <option value="qualifying">qualifying</option>
        <option value="negotiation">negotiation</option>
        <option value="contract_sent">contract sent</option>
        {stage === "won" && <option value="won">won</option>}
        <option value="lost">lost</option>
      </select>
    </form>
  );
}
