import { toSignedPercent } from "@/lib/format";

export default function EdgeChip({ label, edge }: { label: string; edge: number }) {
  const positive = edge > 0.005;
  const negative = edge < -0.005;
  const tone = positive
    ? "bg-accent/8 text-accent ring-accent/20"
    : negative
      ? "bg-accent-3/8 text-accent-3 ring-accent-3/20"
      : "bg-surface text-text-faint ring-border-soft";

  return (
    <div className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-2.5 ring-1 ring-inset ${tone}`}>
      <span className="max-w-full truncate text-[10px] opacity-70">{label}</span>
      <span className="font-display text-[13px] font-semibold tabular-nums">
        {toSignedPercent(edge)}
      </span>
    </div>
  );
}
