"use client";

import { useEffect, useState } from "react";
import AuthSheet from "./AuthSheet";
import { UserIcon } from "./icons";

// The one entry point into the account system — checks session state once on mount, then shows
// either "Log in" (opens AuthSheet) or the logged-in user's own initial (tap to log out). A full
// re-sync of local data into the account happens once, at signup (AuthSheet) — this button itself
// only ever cares about who's currently logged in.
export default function AccountButton() {
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setUsername(data.username ?? null);
      })
      .catch(() => {
        if (!cancelled) setUsername(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUsername(null);
  }

  if (username === undefined) {
    return <div className="h-8 w-8 shrink-0 rounded-full bg-surface-2" />;
  }

  if (username === null) {
    return (
      <>
        <button
          onClick={() => setSheetOpen(true)}
          className="press flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-[11px] font-semibold text-text-dim ring-1 ring-inset ring-border-soft"
        >
          <UserIcon className="h-3.5 w-3.5" />
          Log in
        </button>
        {sheetOpen && (
          <AuthSheet
            onClose={() => setSheetOpen(false)}
            onSuccess={(u) => {
              setUsername(u);
              setSheetOpen(false);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`Account: ${username}`}
        className="press flex h-8 w-8 items-center justify-center rounded-full bg-accent/14 text-[12px] font-bold uppercase text-accent ring-1 ring-inset ring-accent/25"
      >
        {username.slice(0, 1)}
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-10 z-50 min-w-[9.5rem] rounded-2xl border border-border-soft bg-bg-elevated p-1.5 shadow-2xl">
            <p className="truncate px-2.5 py-1.5 text-[11px] font-medium text-text-faint">{username}</p>
            <button
              onClick={() => void handleLogout()}
              className="press w-full rounded-xl px-2.5 py-2 text-left text-[12px] font-medium text-accent-3 hover:bg-surface-2"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
