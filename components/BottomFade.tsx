// A screen-wide darkening gradient sitting just behind BottomNav: fully transparent at the top
// of the nav, fading to 95% opaque black at the very bottom of the screen. Ordinary scrolling
// page content passes underneath it and gets progressively darker as it nears the nav, while the
// nav itself (a higher z-index) always renders crisp on top. Height matches BottomNav's own
// rendered height exactly via the --bottom-nav-height custom property that component publishes,
// so the gradient always starts right at the nav's own top edge on every device.
export default function BottomFade() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[35]"
      style={{
        height: "var(--bottom-nav-height, 84px)",
        background: "linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.95))",
      }}
    />
  );
}
