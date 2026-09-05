"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Discover (Polymarket's non-football markets) is deactivated for now — nav no longer links here
// (components/BottomNav.tsx), and this route bounces straight back to Home rather than rendering
// its old market-browsing UI, so a stale bookmark or the browser's back button can't reach it
// either. The full implementation (market list, category filter, ticker, analysis sheet) isn't
// deleted, just no longer wired up here — recoverable from git history if Discover comes back.
export default function DiscoverPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return null;
}
