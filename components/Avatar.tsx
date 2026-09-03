"use client";

import { useState } from "react";
import { initials, hueFromString } from "@/lib/avatar";
import { useClubLogoUrl } from "./ClubLogosProvider";

export default function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const logoUrl = useClubLogoUrl(name);
  const [broken, setBroken] = useState(false);

  if (logoUrl && !broken) {
    return (
      // External crest URLs from a third-party API aren't in next/image's allowed
      // remote-pattern list, and these are cached client-side rather than re-fetched every render.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={() => setBroken(true)}
      />
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
