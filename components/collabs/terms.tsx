import { TERMS } from "@/lib/collabs";

/** Brand collab terms, as agreed between Commercial and Content. */
export function CollabTerms() {
  return (
    <div className="surface max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h2 className="text-base font-bold text-ink">Brand collab terms</h2>
        <p className="text-sm text-ink-muted">Sending a request means you agree to these.</p>
      </div>
      {TERMS.map((t, i) => (
        <section key={t.title}>
          <h3 className="text-sm font-semibold text-ink">
            {i + 1}. {t.title}
          </h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {t.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
