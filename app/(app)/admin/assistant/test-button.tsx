"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { testAssistant } from "./actions";

export function TestAssistantButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await testAssistant();
            setResult(res.ok ? { ok: true, text: "Claude replied. The assistant is working." } : { ok: false, text: res.error });
          })
        }
      >
        {pending ? "Testing…" : "Test the assistant"}
      </Button>
      {result && <p className={result.ok ? "text-sm text-ink" : "text-sm font-semibold text-ink"}>{result.text}</p>}
    </div>
  );
}
