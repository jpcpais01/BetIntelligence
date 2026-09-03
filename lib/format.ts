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

export function toDecimalOdds(p: number): string {
  if (p <= 0) return "—";
  return (1 / p).toFixed(2);
}
