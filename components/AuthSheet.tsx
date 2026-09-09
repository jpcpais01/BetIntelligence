"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { collectLocalSnapshot, hasLocalDataToMigrate } from "@/lib/auth/localSnapshot";
import { CloseIcon, UserIcon } from "./icons";

// Create-account / log-in, username + password only — no email at all, matching the app's own
// "just username and password" account model (lib/auth/*). Signup optionally carries this
// browser's existing localStorage data (analyzed games, picks, placed bets, portfolio, ...) into
// the new account in the same request, offered as a visible, uncheckable-by-default-only-if-empty
// choice rather than something silently bundled in without the user seeing it.
//
// Rendered via a portal straight into document.body rather than in place: AccountButton (this
// sheet's only trigger today) lives inside a page header that has `backdrop-blur-xl` on it —
// `backdrop-filter` creates a new containing block for `position: fixed` descendants per the CSS
// spec, so without the portal this sheet's `fixed inset-0` would resolve against that small
// header box instead of the real viewport, clipping almost the entire sheet out of view (a real
// bug, caught by screenshotting the actual result rather than assuming the same fixed-overlay
// pattern every other sheet in this app uses would just work unchanged here too). Every other
// sheet (AnalysisSheet, PickDetailSheet, ...) happens to mount straight under a page's own root
// div, never inside a blurred ancestor, which is why none of them needed this.
export default function AuthSheet({ onClose, onSuccess }: { onClose: () => void; onSuccess: (username: string) => void }) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [importLocal, setImportLocal] = useState(true);
  const [hasLocal, setHasLocal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage, unavailable during SSR */
    setHasLocal(hasLocalDataToMigrate());
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const body: Record<string, unknown> = { username, password };
      if (mode === "signup" && importLocal && hasLocal) body.snapshot = collectLocalSnapshot();

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Something went wrong.");
        return;
      }
      onSuccess(data.username as string);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="sheet-up relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-border-soft bg-bg-elevated sm:max-w-sm sm:rounded-3xl sm:border">
        <div className="shrink-0 border-b border-border-soft px-5 pb-3.5 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-2 text-text-dim">
                <UserIcon className="h-4 w-4" />
              </div>
              <p className="font-display text-[15px] font-semibold">{mode === "signup" ? "Create account" : "Log in"}</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="press -mr-1 rounded-full p-2 text-text-faint hover:bg-surface-2">
              <CloseIcon className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-4 flex gap-1.5 rounded-full bg-surface-2 p-1">
            {(["signup", "login"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`press flex-1 rounded-full py-2 text-[12px] font-semibold transition-colors ${
                  mode === m ? "bg-accent/14 text-accent" : "text-text-faint"
                }`}
              >
                {m === "signup" ? "Create account" : "Log in"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-text-faint">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                className="w-full rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-[13px] text-text outline-none focus:border-accent/40"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-text-faint">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                className="w-full rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-[13px] text-text outline-none focus:border-accent/40"
              />
            </div>

            {mode === "signup" && (
              <div>
                <label className="mb-1.5 block text-[11px] font-medium text-text-faint">Confirm password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full rounded-xl border border-border-soft bg-surface px-3.5 py-2.5 text-[13px] text-text outline-none focus:border-accent/40"
                />
              </div>
            )}

            {mode === "signup" && hasLocal && (
              <label className="flex items-start gap-2.5 rounded-xl bg-surface-2 p-3">
                <input
                  type="checkbox"
                  checked={importLocal}
                  onChange={(e) => setImportLocal(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                />
                <span className="text-[11px] leading-relaxed text-text-dim">
                  Import what&rsquo;s already on this device &mdash; analyzed games, picks, placed
                  bets, and your portfolio &mdash; into this new account.
                </span>
              </label>
            )}

            {error && <p className="text-[12px] text-accent-3">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="press mt-1 w-full rounded-full bg-accent/14 py-3 text-[13px] font-semibold text-accent ring-1 ring-inset ring-accent/25 disabled:opacity-50"
            >
              {submitting ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
            </button>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
