"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrophyIcon, BookmarkIcon } from "./icons";

const TABS = [
  { href: "/", label: "Games", icon: TrophyIcon },
  { href: "/picks", label: "My Picks", icon: BookmarkIcon },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-md px-4 pb-4">
        <div className="flex items-center justify-around rounded-2xl border border-border-soft bg-bg-elevated/90 backdrop-blur-xl px-2 py-2 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.6)]">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors ${
                  active ? "text-accent" : "text-text-faint hover:text-text-dim"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "drop-shadow-[0_0_8px_rgba(52,227,154,0.6)]" : ""}`} />
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
