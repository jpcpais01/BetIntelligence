import type { SavedMarketPick, Confidence } from "@/lib/types";
import OutcomeMeter from "./OutcomeMeter";
import { CloseIcon, BrainIcon, ScaleIcon, TrendingUpIcon, GlobeIcon, ExternalLinkIcon } from "./icons";
import { formatEndDate, toSignedPercent, toPercent, formatCostUsd } from "@/lib/format";
import { agreementLabel, agreementTone } from "@/lib/aggregate";

const OUTCOME_COLORS = ["var(--d-accent)", "var(--d-violet)", "var(--d-accent-2)", "#8f9dff", "#ff8a5c", "#5cc9ff"];
const colorFor = (i: number) => OUTCOME_COLORS[i % OUTCOME_COLORS.length];

// A read-only view of a saved Discover pick's full analysis — reopened from Picks/Lab.
export default function MarketPickDetailSheet({ pick, onClose }: { pick: SavedMarketPick; onClose: () => void }) {
  const { independent, comparison, research } = pick;

  return (
    <div className="discover fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        className="sheet-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg border-t sm:max-w-lg sm:rounded-lg sm:border"
        style={{ background: "var(--d-surface)", borderColor: "var(--d-border)" }}
      >
        <div className="shrink-0 border-b px-5 pb-3.5 pt-3" style={{ borderColor: "var(--d-border)" }}>
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-faint">
                <span>{pick.categoryEmoji}</span>
                <span className="truncate">
                  {pick.category} &middot; {formatEndDate(pick.endDate)}
                </span>
              </div>
              <div className="truncate text-[15px] font-semibold text-text">{pick.title}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={pick.polymarketUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open on Polymarket"
                className="press rounded-sm p-2 text-text-faint ring-1 ring-inset hover:text-text"
                style={{ borderColor: "var(--d-border)" }}
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
              </a>
              <button onClick={onClose} aria-label="Close" className="press rounded-sm p-2 text-text-faint hover:bg-white/5">
                <CloseIcon className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            <SectionHeader icon={BrainIcon} step={1} title="Independent read" subtitle="Formed before seeing any market odds" />

            <div className="space-y-3.5 rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface-2)" }}>
              {independent.outcomes.map((o, i) => (
                <OutcomeMeter key={o.label} label={o.label} pct={o.probability} color={colorFor(i)} size="lg" />
              ))}
            </div>

            {research && research.runCount > 1 && <RunsBreakdown research={research} />}

            <DiscoverConfidence level={independent.confidence} />

            {independent.keyFactors.length > 0 && (
              <ul className="selectable space-y-2">
                {independent.keyFactors.map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-text-dim">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--d-accent-2)" }} />
                    {f}
                  </li>
                ))}
              </ul>
            )}

            {independent.rationale && (
              <p className="selectable text-[13px] leading-relaxed text-text-dim">{independent.rationale}</p>
            )}

            <SourceList sources={independent.sources ?? []} />
          </div>

          <div className="mt-6 space-y-4">
            <SectionHeader icon={ScaleIcon} step={2} title="Market comparison" subtitle="Polymarket odds revealed" />

            <div className="space-y-3.5 rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface-2)" }}>
              {pick.market.map((o, i) => {
                const aiEst = independent.outcomes.find((p) => p.label === o.label)?.probability;
                return (
                  <OutcomeMeter key={o.label} label={o.label} pct={o.price} color={colorFor(i)} markerPct={aiEst} markerLabel="AI estimate" />
                );
              })}
              <p className="pt-0.5 text-[11px] text-text-faint">Bars show the market. The line marks the AI&apos;s own estimate.</p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {comparison.edges.map((e) => (
                <DiscoverEdgeChip key={e.label} label={e.label} edge={e.edge} />
              ))}
            </div>

            {comparison.bestValue ? (
              <div
                className="flex items-start gap-2.5 rounded-md p-3.5 ring-1 ring-inset"
                style={{ background: "rgba(var(--d-accent-rgb),0.08)", borderColor: "var(--d-accent)" }}
              >
                <TrendingUpIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--d-accent)" }} />
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--d-accent)" }}>
                    Possible value
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-dim">
                    The AI rated <strong className="font-medium text-text">{comparison.bestValue}</strong> higher than the
                    market did.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 rounded-md border p-3.5" style={{ borderColor: "var(--d-border)" }}>
                <ScaleIcon className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" />
                <div>
                  <p className="text-[13px] font-semibold text-text">Market looked efficient</p>
                  <p className="mt-0.5 text-xs text-text-dim">No meaningful edge on this one.</p>
                </div>
              </div>
            )}

            <DiscoverConfidence level={comparison.confidence} />

            {comparison.verdict && <p className="selectable text-[13px] leading-relaxed text-text-dim">{comparison.verdict}</p>}

            {formatCostUsd(pick.totalCostUsd) && (
              <p className="text-center text-[11px] tabular-nums text-text-faint">
                Analysis cost: {formatCostUsd(pick.totalCostUsd)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunsBreakdown({ research }: { research: NonNullable<SavedMarketPick["research"]> }) {
  const tone = agreementTone(research);
  const toneColor = tone === "high" ? "var(--d-accent)" : tone === "medium" ? "var(--d-accent-2)" : "#ff6b6b";

  return (
    <div className="rounded-md border p-4" style={{ borderColor: "var(--d-border)", background: "var(--d-surface-2)" }}>
      <p className="text-[12px] font-medium" style={{ color: toneColor }}>
        {agreementLabel(research)}
      </p>
      <div className="mt-3 space-y-2">
        {research.runs.map((outcomes, i) => (
          <div key={i} className="text-[11px] text-text-faint">
            <span className="text-text-dim">Run {i + 1}:</span>{" "}
            {outcomes
              .slice()
              .sort((a, b) => b.probability - a.probability)
              .slice(0, 3)
              .map((o) => `${o.label} ${toPercent(o.probability)}`)
              .join(" · ")}
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[10px] text-text-faint">Top outcomes per independent run.</p>
    </div>
  );
}

function SourceList({ sources }: { sources: { url: string; title: string }[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="rounded-md border p-3.5" style={{ borderColor: "var(--d-border)" }}>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text-faint">
        <GlobeIcon className="h-3 w-3" />
        {sources.length} source{sources.length === 1 ? "" : "s"} consulted
      </p>
      <ul className="space-y-1.5">
        {sources.map((s) => (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-xs text-text-dim underline-offset-2 hover:underline"
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  step,
  title,
  subtitle,
}: {
  icon: (props: { className?: string }) => React.ReactElement;
  step: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-dim" style={{ background: "var(--d-surface-2)" }}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-text-faint" style={{ background: "var(--d-surface-2)" }}>
            {step}/2
          </span>
          <p className="truncate text-[13px] font-semibold text-text">{title}</p>
        </div>
        <p className="text-[11px] text-text-faint">{subtitle}</p>
      </div>
    </div>
  );
}

function DiscoverConfidence({ level }: { level: Confidence }) {
  const label = level === "high" ? "High confidence" : level === "medium" ? "Medium confidence" : "Low confidence";
  const color = level === "high" ? "var(--d-accent)" : level === "medium" ? "var(--d-accent-2)" : "var(--text-faint)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset" style={{ color, borderColor: color, background: "transparent" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function DiscoverEdgeChip({ label, edge }: { label: string; edge: number }) {
  const positive = edge > 0.005;
  const negative = edge < -0.005;
  const color = positive ? "var(--d-accent)" : negative ? "var(--d-accent-2)" : "var(--text-faint)";
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-sm px-2 py-2.5 ring-1 ring-inset" style={{ color, borderColor: `${color}33`, background: `${color}14` }}>
      <span className="max-w-full truncate text-[10px] opacity-80">{label}</span>
      <span className="font-display text-[13px] font-semibold tabular-nums">{toSignedPercent(edge)}</span>
    </div>
  );
}
