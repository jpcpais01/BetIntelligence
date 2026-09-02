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
