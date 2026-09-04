export function formatKickoff(iso: string): { label: string; isLive: boolean } {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = diffMs / 3_600_000;

  if (diffH <= 0 && diffH > -3) {
    return { label: "LIVE NOW", isLive: true };
  }

  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return { label: `Today, ${time}`, isLive: false };

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) {
    return { label: `Tomorrow, ${time}`, isLive: false };
  }

  const dateLabel = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return { label: `${dateLabel}, ${time}`, isLive: false };
}

export function formatEndDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return "Resolving";

  const diffDays = diffMs / 86_400_000;
  if (diffDays < 1) return "Ends today";
  if (diffDays < 2) return "Ends tomorrow";
  if (diffDays < 7) return `Ends in ${Math.round(diffDays)}d`;
  if (diffDays < 60) return `Ends in ${Math.round(diffDays / 7)}w`;
  return `Ends ${d.toLocaleDateString([], { month: "short", year: "numeric" })}`;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "never";

  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function toPercent(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function toSignedPercent(p: number): string {
  const pct = p * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}pp`;
}

// A relative return (e.g. portfolio P&L vs. baseline) — no "pp" suffix, since that's specific to
// a percentage-POINT difference between two probabilities, not a proportional change.
export function toSignedReturnPercent(p: number): string {
  const pct = p * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function toDecimalOdds(p: number): string {
  if (p <= 0) return "—";
  return (1 / p).toFixed(2);
}

// The Home portfolio's paper currency. Always 2 decimals, comma-grouped, sign in front of the
// symbol (not after the number) — "-€12.34", never "€-12.34".
export function formatEur(amount: number): string {
  if (!Number.isFinite(amount)) return "€0.00";
  const sign = amount < 0 ? "-" : "";
  return `${sign}€${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Analysis costs are typically fractions of a cent, so a flat 2-decimal format would round
// almost everything to "$0.00" — scale precision to the size of the number instead. Returns
// null when there's nothing to show (no cost data, e.g. a provider that doesn't report it, or
// mock mode) so callers can render nothing rather than "$undefined".
export function formatCostUsd(cost: number | undefined): string | null {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return null;
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
