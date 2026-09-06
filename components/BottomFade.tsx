// A screen-wide darkening gradient sitting just behind BottomNav: fully transparent above the
// nav, fading to 95% opaque black at the very bottom of the screen. Ordinary scrolling page
// content passes underneath it and gets progressively darker as it nears the nav, while the nav
// itself (a higher z-index) always renders crisp on top. Height is BottomNav's own rendered height
// (via the --bottom-nav-height custom property that component publishes, so it always matches on
// every device) plus a fixed extra margin, so the fade's transparent edge starts a bit above the
// nav's own top rather than exactly flush with it — a softer transition into the bar.
const EXTRA_FADE_PX = 32;

export default function BottomFade() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[35]"
      style={{
        height: `calc(var(--bottom-nav-height, 84px) + ${EXTRA_FADE_PX}px)`,
        background: "linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.95))",
      }}
    />
  );
}
