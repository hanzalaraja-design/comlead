"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClaudeKey, revokeClaudeKey } from "@/app/(app)/settings/actions";

export type ClaudeKey = { id: string; name: string; prefix: string; created: string; lastUsed: string | null };

export function ClaudeConnector({ keys }: { keys: ClaudeKey[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      const res = await createClaudeKey("Claude");
      if (res.ok && res.data) {
        setUrl(res.data.url);
        setCopied(false);
      } else if (!res.ok) toast.error(res.error);
    });

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it yourself.");
    }
  };

  const revoke = (id: string) =>
    startTransition(async () => {
      const res = await revokeClaudeKey(id);
      if (res.ok) toast.success("Link turned off. Claude can't use it any more.");
      else toast.error(res.error);
    });

  return (
    <div className="space-y-5">
      <div>
        <p className="font-semibold">Use Highfy Tasks from Claude</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Ask Claude what&apos;s due, create tasks or update them. Claude acts as you and sees only what you can see. It can&apos;t
          delete anything.
        </p>
      </div>

      {url ? (
        <div className="space-y-2 rounded-[12px] border border-line bg-subtle p-3">
          <p className="text-[13px] font-semibold">Your link (shown once)</p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Your Claude link"
              className="h-9 min-w-0 flex-1 rounded-[10px] border border-line bg-white px-3 font-mono text-xs"
            />
            <Button size="sm" onClick={copy}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-[12px] text-ink-muted">Anyone with this link can act as you, so keep it to yourself.</p>
        </div>
      ) : (
        <Button onClick={create} disabled={pending}>
          {keys.length ? "Make a new link" : "Make my link"}
        </Button>
      )}

      <ol className="list-decimal space-y-1 pl-5 text-[13px]">
        <li>Copy your link.</li>
        <li>
          In Claude, open <span className="font-semibold">Settings → Connectors</span> and choose{" "}
          <span className="font-semibold">Add custom connector</span>.
        </li>
        <li>
          Name it <span className="font-semibold">Highfy Tasks</span>, paste the link and click <span className="font-semibold">Add</span>.
        </li>
        <li>In a new chat, try: &ldquo;What&apos;s overdue for me?&rdquo;</li>
      </ol>

      {keys.length > 0 && (
        <div>
          <p className="kicker mb-2">Your links</p>
          <ul className="divide-y divide-line rounded-[12px] border border-line">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <p className="truncate">
                    {k.name} <span className="font-mono text-xs text-ink-muted">{k.prefix}…</span>
                  </p>
                  <p className="text-[12px] text-ink-muted">
                    Made {k.created} · {k.lastUsed ? `last used ${k.lastUsed}` : "not used yet"}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => revoke(k.id)}>
                  Turn off
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-muted">If a link gets shared by mistake, turn it off and make a new one.</p>
        </div>
      )}
    </div>
  );
}
