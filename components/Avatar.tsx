import { initials, hueFromString } from "@/lib/avatar";

export default function Avatar({ name, size = 32 }: { name: string; size?: number }) {
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
