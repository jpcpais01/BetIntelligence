"use client";

import { useEffect, useRef, useState } from "react";
import { MODELS, DEFAULT_MODEL, loadSelectedModel, saveSelectedModel, type ModelId } from "@/lib/models";
import { ChevronDownIcon, CheckIcon } from "./icons";

// Which OpenRouter model powers every AI analysis call, football and Discover alike — a single
// global choice (not per-page) since it's the same underlying analysis pipeline either way.
export default function ModelPicker({ variant = "standard" }: { variant?: "standard" | "discover" }) {
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [open, setOpen] = useState(false);
  // The panel is fixed-positioned (computed from the button's own rect) rather than absolutely
  // anchored to this component, since Discover's header uses overflow-hidden for its scanline
  // background and marquee — an absolutely-positioned dropdown there would get silently clipped.
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage, unavailable during SSR */
    setModel(loadSelectedModel());
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  };

  const choose = (id: ModelId) => {
    setModel(id);
    saveSelectedModel(id);
    setOpen(false);
  };

  const current = MODELS[model];
  const discover = variant === "discover";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        aria-label="Choose AI model"
        aria-expanded={open}
        className={
          discover
            ? "press flex items-center gap-1 rounded-sm px-2.5 py-2.5 text-[10px] font-bold uppercase tracking-widest ring-1 ring-inset"
            : "press flex items-center gap-1 rounded-full bg-surface px-3 py-2.5 text-[11px] font-medium text-text-dim ring-1 ring-inset ring-border-soft"
        }
        style={
          discover
            ? { color: "var(--d-accent)", borderColor: "var(--d-border)", background: "var(--d-surface-2)" }
            : undefined
        }
      >
        {current.shortLabel}
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && panelPos && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            className={
              discover
                ? "fixed z-50 w-60 rounded-sm p-1.5 ring-1 ring-inset"
                : "fixed z-50 w-60 rounded-2xl border border-border-soft bg-surface p-1.5 shadow-lg"
            }
            style={{
              top: panelPos.top,
              right: panelPos.right,
              ...(discover ? { background: "var(--d-surface)", borderColor: "var(--d-border)" } : {}),
            }}
          >
            {Object.values(MODELS).map((m) => {
              const active = m.id === model;
              return (
                <button
                  key={m.id}
                  onClick={() => choose(m.id)}
                  className={
                    discover
                      ? "press flex w-full items-start gap-2 rounded-sm px-2.5 py-2 text-left"
                      : `press flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left ${active ? "bg-surface-2" : ""}`
                  }
                  style={discover ? { background: active ? "var(--d-surface-2)" : "transparent" } : undefined}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={discover ? "text-[11px] font-semibold" : "text-[12px] font-semibold text-text"}
                      style={discover ? { color: "var(--d-accent)" } : undefined}
                    >
                      {m.label}
                    </p>
                    <p className="text-[10px] text-text-faint">{m.description}</p>
                  </div>
                  {active && (
                    <CheckIcon
                      className={discover ? "mt-0.5 h-3.5 w-3.5 shrink-0" : "mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"}
                      style={discover ? { color: "var(--d-accent)" } : undefined}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
