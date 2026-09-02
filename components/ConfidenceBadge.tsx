import type { Confidence } from "@/lib/types";

const STYLES: Record<Confidence, string> = {
  low: "bg-surface-2 text-text-faint ring-border-soft",
  medium: "bg-warn/10 text-warn ring-warn/20",
  high: "bg-accent/10 text-accent ring-accent/20",
};

const LABEL: Record<Confidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

export default function ConfidenceBadge({ level }: { level: Confidence }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${STYLES[level]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABEL[level]}
    </span>
  );
}
