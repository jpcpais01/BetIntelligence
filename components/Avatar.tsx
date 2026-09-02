"use client";

import { useState } from "react";
import { initials, hueFromString } from "@/lib/avatar";
import { useClubLogoUrl } from "./ClubLogosProvider";

export default function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const logoUrl = useClubLogoUrl(name);
  const [broken, setBroken] = useState(false);

  if (logoUrl && !broken) {
    return (
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-border-soft"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- external crest URLs from a
            third-party API aren't in next/image's allowed remote-pattern list, and there are
            too few of these (~45, cached client-side) to justify the config for it */}
        <img
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-contain p-[12%]"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      </div>
    );
  }

  const hue = hueFromString(name);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(145deg, hsl(${hue} 75% 52%), hsl(${(hue + 40) % 360} 70% 32%))`,
      }}
    >
      {initials(name)}
    </div>
  );
}
