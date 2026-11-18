"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { makeWhatsAppCode, unlinkWhatsApp } from "@/app/(app)/settings/actions";

/** Link your WhatsApp number: make a code here, send "link <code>" to the Highfy Tasks number. */
export function WhatsAppLink({ linkedPhone, botNumber, available }: { linkedPhone: string | null; botNumber: string | null; available: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const digits = botNumber?.replace(/\D/g, "") ?? "";

  if (!available) return <p className="text-[13px] text-ink-muted">WhatsApp isn&apos;t connected on this site yet. Ask an Admin.</p>;

  if (linkedPhone)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink">
          Linked to <b>+{linkedPhone}</b>. Send tasks to {botNumber ? <b>{botNumber}</b> : "the Highfy Tasks number"} as a message or a voice note.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await unlinkWhatsApp();
              if (!res.ok) toast.error(res.error);
            })
          }
        >
          Unlink
        </Button>
      </div>
    );

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-muted">
        Send a message or voice note like &ldquo;Ask Bilal to send the banner sizes by Friday&rdquo; and the task is made for you. First link your number.
      </p>
      {code ? (
        <div className="rounded-[14px] bg-brand-bg px-4 py-3 text-sm text-ink">
          From your WhatsApp, send{" "}
          <b className="rounded bg-white px-1.5 py-0.5 font-mono">link {code}</b> to {botNumber ? <b>{botNumber}</b> : "the Highfy Tasks number"}. The code works for 15 minutes.
          {digits && (
            <a href={`https://wa.me/${digits}?text=${encodeURIComponent(`link ${code}`)}`} target="_blank" rel="noreferrer" className="ml-2 font-semibold text-brand-primary hover:underline">
              Open WhatsApp
            </a>
          )}
        </div>
      ) : (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await makeWhatsAppCode();
              if (res.ok) setCode(res.data!.code);
              else toast.error(res.error);
            })
          }
        >
          <MessageCircle className="h-4 w-4" /> Link my WhatsApp
        </Button>
      )}
    </div>
  );
}
