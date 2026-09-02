import { toSignedPercent } from "@/lib/format";

export default function EdgeChip({ label, edge }: { label: string; edge: number }) {
  const positive = edge > 0.005;
  const negative = edge < -0.005;
  const tone = positive
    ? "bg-accent/15 text-accent border-accent/30"
    : negative
      ? "bg-accent-3/15 text-accent-3 border-accent-3/30"
      : "bg-surface-2 text-text-faint border-border-soft";

  return (
    <div className={`flex flex-col items-center gap-1 rounded-2xl border px-3 py-2.5 ${tone}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</span>
      <span className="font-display text-sm font-semibold">{toSignedPercent(edge)}</span>
    </div>
  );
}
