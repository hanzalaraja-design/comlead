/** "7 of 12 done this week" as a ring that fills grey to green. */
export function ProgressRing({ done, total, size = 64 }: { done: number; total: number; size?: number }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total ? Math.min(done / total, 1) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${done} of ${total} done this week`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-subtle" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="stroke-success transition-[stroke-dashoffset] duration-700 ease-out"
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-ink text-[15px] font-semibold">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}
