"use client";

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

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border-soft bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-md items-stretch px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`press flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium ${
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
