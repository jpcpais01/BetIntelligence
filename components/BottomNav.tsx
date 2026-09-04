"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, CompassIcon, TrophyIcon, BookmarkIcon, TicketIcon } from "./icons";

const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/discover", label: "Discover", icon: CompassIcon },
  { href: "/sports", label: "Sports", icon: TrophyIcon },
  { href: "/picks", label: "Picks", icon: BookmarkIcon },
  { href: "/lab", label: "Lab", icon: TicketIcon },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // Published as a CSS custom property so BottomFade (the darkening gradient behind this bar,
  // app/layout.tsx) can size itself to match this bar's actual rendered height exactly — which
  // varies with the device's safe-area inset — rather than duplicating the same padding/height
  // math in two places and risking the two drifting apart.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty("--bottom-nav-height", `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <nav ref={navRef} className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-md items-stretch rounded-3xl border border-border-soft bg-bg-elevated/90 px-2 py-1.5 shadow-lg backdrop-blur-xl">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`press flex flex-1 flex-col items-center gap-1 rounded-2xl py-2 text-[10px] font-medium ${
                active ? "text-accent" : "text-text-faint"
              }`}
            >
              <Icon className="h-[22px] w-[22px]" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
