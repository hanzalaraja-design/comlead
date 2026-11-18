import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { aiEnvReport } from "@/lib/ai/claude";
import { whatsappEnvReport } from "@/lib/whatsapp";
import { TestAssistantButton } from "./test-button";

export const metadata = { title: "Meeting assistant · Highfy Tasks" };

function Row({ label, ok, children }: { label: string; ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={ok ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-muted" : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning"} />
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-sm text-ink-muted">{children}</p>
      </div>
    </li>
  );
}

export default async function AssistantStatusPage() {
  await requireAdmin();
  const env = aiEnvReport();
  const wa = whatsappEnvReport();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader breadcrumb={["Admin", "Meeting assistant"]} title="Meeting assistant" />
      <section className="card-outlined p-4 md:p-6">
        <ul className="divide-y divide-line">
          <Row label="API key" ok={env.keySet}>
            {env.keySet
              ? "ANTHROPIC_API_KEY is set on this deployment."
              : "ANTHROPIC_API_KEY isn't set on this deployment, so the assistant buttons are hidden."}
          </Row>
          {env.keySet && (
            <Row label="Key format" ok={env.looksRight}>
              {env.looksRight ? "Starts with sk-ant-, as expected." : "Doesn't start with sk-ant-. Check you pasted the key itself, not its name."}
            </Row>
          )}
          {env.hadWhitespace && (
            <Row label="Spaces" ok={false}>
              The key has spaces or a line break around it. The app ignores them, but it&apos;s worth re-pasting it cleanly.
            </Row>
          )}
          {env.similarNames.length > 0 && (
            <Row label="Similar names found" ok={false}>
              Found {env.similarNames.map((n) => `"${n}"`).join(", ")}. The name must be exactly ANTHROPIC_API_KEY.
            </Row>
          )}
          <Row label="This deployment" ok>
            {env.environment}
            {env.host && ` · ${env.host}`}
            {env.commit && ` · commit ${env.commit}`}
            {wa.deployment && ` · ${wa.deployment}`}
          </Row>
        </ul>
      </section>
      {env.keySet ? (
        <section className="card-outlined space-y-3 p-4 md:p-6">
          <p className="text-sm text-ink-muted">Send Claude one small request to check the key and billing.</p>
          <TestAssistantButton />
        </section>
      ) : (
        <section className="card-filled space-y-2 p-4 text-sm text-ink md:p-6">
          <p className="font-semibold">To turn it on</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>In Vercel, open the project shown above, then Settings, Environment Variables.</li>
            <li>Add ANTHROPIC_API_KEY with the key as its value, ticked for Production.</li>
            <li>Go to Deployments, open the top one&apos;s menu and click Redeploy.</li>
          </ol>
        </section>
      )}
      <section className="card-outlined p-4 md:p-6">
        <h2 className="kicker mb-1">WhatsApp</h2>
        <p className="text-sm text-ink-muted">What this deployment can see. Lengths only; values are never shown.</p>
        <ul className="divide-y divide-line">
          {wa.vars.map((v) => (
            <Row key={v.name} label={v.name} ok={v.set && !v.hadWhitespace}>
              {v.set ? `Set, ${v.length} characters.` : "Not set on this deployment."}
              {v.hadWhitespace && " Has spaces or a line break around it (ignored, but worth re-pasting)."}
            </Row>
          ))}
          {wa.similarNames.length > 0 && (
            <Row label="Similar names found" ok={false}>
              Found {wa.similarNames.map((n) => `"${n}"`).join(", ")}. Names must match exactly, in capitals.
            </Row>
          )}
        </ul>
      </section>
    </div>
  );
}
