// The user's choice of which OpenRouter model powers every AI analysis call, football and
// Discover markets alike. Kept as a small whitelist (rather than a free-text field) so an API
// route can safely resolve a client-supplied id to a real OpenRouter model string without ever
// forwarding arbitrary client input into a third-party API call.
export type ModelId = "deepseek" | "glm" | "gemini" | "nemotron";

export interface ModelInfo {
  id: ModelId;
  openrouterId: string;
  label: string;
  shortLabel: string;
  description: string;
}

export const MODELS: Record<ModelId, ModelInfo> = {
  deepseek: {
    id: "deepseek",
    openrouterId: "deepseek/deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    shortLabel: "DeepSeek",
    description: "Fast MoE model, strong reasoning-to-cost ratio.",
  },
  glm: {
    id: "glm",
    openrouterId: "z-ai/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    shortLabel: "GLM",
    description: "Z.AI's fast model, a different take on the same read.",
  },
  gemini: {
    id: "gemini",
    openrouterId: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    shortLabel: "Gemini",
    description: "Google's fast model, a third independent take on the same read.",
  },
  nemotron: {
    id: "nemotron",
    openrouterId: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Nemotron 3 Ultra",
    shortLabel: "Nemotron",
    description: "NVIDIA's large MoE model, built for deep multi-step reasoning.",
  },
};

export const DEFAULT_MODEL: ModelId = "deepseek";

export function isModelId(value: unknown): value is ModelId {
  return value === "deepseek" || value === "glm" || value === "gemini" || value === "nemotron";
}

// Server-side: turn a (possibly untrusted, client-supplied) model choice into the real
// OpenRouter model id, falling back to the default for anything not in the whitelist.
export function resolveOpenRouterModel(value: unknown): string {
  return MODELS[isModelId(value) ? value : DEFAULT_MODEL].openrouterId;
}

const STORAGE_KEY = "betintelligence.model.v1";

export function loadSelectedModel(): ModelId {
  if (typeof window === "undefined") return DEFAULT_MODEL;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isModelId(raw) ? raw : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function saveSelectedModel(id: ModelId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage can be unavailable (private mode, quota) — the choice just won't persist.
  }
}
