"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { resolveTopTeamCanonical } from "@/lib/topTeams";
import { loadCachedLogos, saveCachedLogos, isLogoCacheStale } from "@/lib/logoCache";

const ClubLogosContext = createContext<Record<string, string>>({});

export default function ClubLogosProvider({ children }: { children: React.ReactNode }) {
  const [logos, setLogos] = useState<Record<string, string>>({});

  useEffect(() => {
    const cached = loadCachedLogos();
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR
      setLogos(cached.logos);
    }
    if (!cached || isLogoCacheStale(cached.fetchedAt)) {
      fetch("/api/logos")
        .then((res) => res.json())
        .then((data: { logos?: Record<string, string> }) => {
          if (data.logos && Object.keys(data.logos).length > 0) {
            setLogos(data.logos);
            saveCachedLogos(data.logos);
          }
        })
        .catch(() => {
          // No logos this session — every Avatar just falls back to initials.
        });
    }
  }, []);

  return <ClubLogosContext.Provider value={logos}>{children}</ClubLogosContext.Provider>;
}

export function useClubLogoUrl(teamName: string): string | null {
  const logos = useContext(ClubLogosContext);
  const canonical = resolveTopTeamCanonical(teamName);
  if (!canonical) return null;
  return logos[canonical] ?? null;
}
