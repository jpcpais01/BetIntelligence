import type { Confidence } from "@/lib/types";

const STYLES: Record<Confidence, string> = {
  low: "bg-surface-2 text-text-faint border-border-soft",
  medium: "bg-warn/15 text-warn border-warn/30",
  high: "bg-accent/15 text-accent border-accent/30",
};

const LABEL: Record<Confidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

export default function ConfidenceBadge({ level }: { level: Confidence }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STYLES[level]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABEL[level]}
    </span>
  );
}
