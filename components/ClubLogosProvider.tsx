"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { loadCachedLogos, saveCachedLogos } from "@/lib/logoCache";
import { MAX_LOGO_NAMES_PER_REQUEST } from "@/lib/clubLogos";

interface ClubLogosContextValue {
  logos: Record<string, string>;
  requestLogos: (names: string[]) => void;
}

const ClubLogosContext = createContext<ClubLogosContextValue>({
  logos: {},
  requestLogos: () => {},
});

export default function ClubLogosProvider({ children }: { children: React.ReactNode }) {
  const [logos, setLogos] = useState<Record<string, string>>({});
  // Every name ever asked for, found or not — crests don't change, so once a name has been
  // tried there's never a reason to ask TheSportsDB about it again.
  const attemptedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);
  // Names asked for before hydration finished (child components mount, and can call
  // requestLogos, before this provider's own mount effect below has run) — flushed once
  // hydration completes instead of the callback awkwardly calling itself to retry.
  const pendingRef = useRef<string[]>([]);

  const doRequest = useCallback((names: string[]) => {
    const missing = [...new Set(names.map((n) => n.trim()).filter(Boolean))].filter(
      (n) => !attemptedRef.current.has(n) && !inFlightRef.current.has(n)
    );
    if (missing.length === 0) return;

    for (const n of missing) inFlightRef.current.add(n);

    // A single caller's list is already capped in practice (one page's worth of games/picks),
    // but batch defensively in case several callers fire around the same time.
    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += MAX_LOGO_NAMES_PER_REQUEST) {
      batches.push(missing.slice(i, i + MAX_LOGO_NAMES_PER_REQUEST));
    }

    for (const batch of batches) {
      fetch("/api/logos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ names: batch }),
      })
        .then((res) => res.json())
        .then((data: { logos?: Record<string, string> }) => {
          for (const n of batch) {
            attemptedRef.current.add(n);
            inFlightRef.current.delete(n);
          }
          setLogos((current) => {
            const next =
              data.logos && Object.keys(data.logos).length > 0 ? { ...current, ...data.logos } : current;
            saveCachedLogos(next, [...attemptedRef.current]);
            return next;
          });
        })
        .catch(() => {
          for (const n of batch) inFlightRef.current.delete(n);
          // No logos this round — those Avatars just fall back to initials; not marked
          // "attempted" so a later retry (e.g. next visit) can still try again.
        });
    }
    // refs (attempted/inFlight) intentionally aren't deps — mutating them shouldn't recreate
    // this callback, and every state read above goes through setLogos's functional updater.
  }, []);

  useEffect(() => {
    const cached = loadCachedLogos();
    if (cached) {
      attemptedRef.current = new Set(cached.attempted);
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
      setLogos(cached.logos);
    }
    hydratedRef.current = true;
    if (pendingRef.current.length > 0) {
      const names = pendingRef.current;
      pendingRef.current = [];
      doRequest(names);
    }
  }, [doRequest]);

  const requestLogos = useCallback(
    (names: string[]) => {
      if (!hydratedRef.current) {
        pendingRef.current.push(...names);
        return;
      }
      doRequest(names);
    },
    [doRequest]
  );

  return (
    <ClubLogosContext.Provider value={{ logos, requestLogos }}>{children}</ClubLogosContext.Provider>
  );
}

export function useClubLogoUrl(teamName: string): string | null {
  const { logos } = useContext(ClubLogosContext);
  return logos[teamName.trim()] ?? null;
}

export function useRequestLogos(): (names: string[]) => void {
  return useContext(ClubLogosContext).requestLogos;
}
