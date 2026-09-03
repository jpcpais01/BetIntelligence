import type { SavedPick } from "@/lib/types";
import OutcomeBar from "./OutcomeBar";
import ConfidenceBadge from "./ConfidenceBadge";
import EdgeChip from "./EdgeChip";
import { CloseIcon, BrainIcon, ScaleIcon, TrendingUpIcon, GlobeIcon } from "./icons";
import { formatKickoff, toPercent } from "@/lib/format";
import { agreementLabel, agreementTone } from "@/lib/aggregate";

// A read-only view of a saved pick's full analysis — the same independent-read and
// market-comparison report shown live while analyzing, reopened from Picks/Lab after the fact.
export default function PickDetailSheet({ pick, onClose }: { pick: SavedPick; onClose: () => void }) {
  const { label: kickoffLabel } = formatKickoff(pick.startTime);
  const { independent, comparison, research } = pick;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="sheet-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border-soft bg-bg-elevated sm:max-w-lg sm:rounded-3xl sm:border">
        <div className="shrink-0 border-b border-border-soft px-5 pb-3.5 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
                <span>{pick.leagueFlag}</span>
                <span className="truncate">
                  {pick.leagueName} &middot; {kickoffLabel}
                </span>
              </div>
              <div className="truncate font-display text-[15px] font-semibold">
                {pick.homeTeam} <span className="text-text-faint">v</span> {pick.awayTeam}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="press -mr-1 shrink-0 rounded-full p-2 text-text-faint hover:bg-surface-2"
            >
              <CloseIcon className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            <SectionHeader icon={BrainIcon} step={1} title="Independent read" subtitle="Formed before seeing any market odds" />

            <div className="space-y-3.5 rounded-2xl border border-border-soft bg-surface p-4">
              <OutcomeBar label={pick.homeTeam} pct={independent.home} color="home" size="lg" />
              <OutcomeBar label="Draw" pct={independent.draw} color="draw" size="lg" />
              <OutcomeBar label={pick.awayTeam} pct={independent.away} color="away" size="lg" />
            </div>

            {research && research.runCount > 1 && (
              <RunsBreakdown research={research} />
            )}

            <ConfidenceBadge level={independent.confidence} />

            {independent.keyFactors.length > 0 && (
              <ul className="selectable space-y-2">
                {independent.keyFactors.map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-text-dim">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
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

            <div className="space-y-3.5 rounded-2xl border border-border-soft bg-surface p-4">
              <OutcomeBar label={pick.homeTeam} pct={pick.market.home} color="home" markerPct={independent.home} markerLabel="AI estimate" />
              <OutcomeBar label="Draw" pct={pick.market.draw} color="draw" markerPct={independent.draw} markerLabel="AI estimate" />
              <OutcomeBar label={pick.awayTeam} pct={pick.market.away} color="away" markerPct={independent.away} markerLabel="AI estimate" />
              <p className="pt-0.5 text-[11px] text-text-faint">Bars show the market. The line marks the AI&apos;s own estimate.</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <EdgeChip label={pick.homeTeam.split(" ")[0]} edge={comparison.edges.home} />
              <EdgeChip label="Draw" edge={comparison.edges.draw} />
              <EdgeChip label={pick.awayTeam.split(" ")[0]} edge={comparison.edges.away} />
            </div>

            {comparison.bestValue !== "none" ? (
              <div className="flex items-start gap-2.5 rounded-2xl bg-accent/8 p-3.5 ring-1 ring-inset ring-accent/25">
                <TrendingUpIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div>
                  <p className="text-[13px] font-semibold text-accent">Possible value</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-dim">
                    The AI rated{" "}
                    <strong className="font-medium text-text">
                      {comparison.bestValue === "draw"
                        ? "the draw"
                        : comparison.bestValue === "home"
                          ? pick.homeTeam
                          : pick.awayTeam}
                    </strong>{" "}
                    higher than the market did.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 rounded-2xl border border-border-soft bg-surface p-3.5">
                <ScaleIcon className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" />
                <div>
                  <p className="text-[13px] font-semibold text-text">Market looked efficient</p>
                  <p className="mt-0.5 text-xs text-text-dim">No meaningful edge on this one.</p>
                </div>
              </div>
            )}

            <ConfidenceBadge level={comparison.confidence} />

            {comparison.verdict && (
              <p className="selectable text-[13px] leading-relaxed text-text-dim">{comparison.verdict}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RunsBreakdown({ research }: { research: NonNullable<SavedPick["research"]> }) {
  const tone = agreementTone(research);
  const toneColor = tone === "high" ? "text-accent" : tone === "medium" ? "text-warn" : "text-accent-3";

  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-4">
      <p className={`text-[12px] font-medium ${toneColor}`}>{agreementLabel(research)}</p>
      <div className="mt-3 space-y-1.5">
        {research.runs.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px] tabular-nums text-text-faint">
            <span className="w-11 shrink-0 text-text-dim">Run {i + 1}</span>
            <span className="flex-1 truncate">
              {toPercent(r.home)} / {toPercent(r.draw)} / {toPercent(r.away)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[10px] text-text-faint">Home / Draw / Away, one row per independent run.</p>
    </div>
  );
}

function SourceList({ sources }: { sources: { url: string; title: string }[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border-soft bg-surface p-3.5">
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
              className="block truncate text-xs text-text-dim underline-offset-2 hover:text-accent hover:underline"
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-dim">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-text-faint">
            {step}/2
          </span>
          <p className="truncate text-[13px] font-semibold text-text">{title}</p>
        </div>
        <p className="text-[11px] text-text-faint">{subtitle}</p>
      </div>
    </div>
  );
}
