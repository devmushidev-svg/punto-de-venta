export const PF_THEME_STORAGE_KEY = "pf-theme";

export const PF_THEME_META_COLOR_VAR = "--pf-theme-color";

export type PfThemeId = "default" | "slate" | "ocean";

export type PfThemePreset = {
  id: PfThemeId;
  label: string;
  datasetValue?: string;
  fallbackThemeColor: string;
};

export const PF_THEME_PRESETS: Record<PfThemeId, PfThemePreset> = {
  default: {
    id: "default",
    label: "Cobre",
    fallbackThemeColor: "#fff7ed",
  },
  slate: {
    id: "slate",
    label: "Slate",
    datasetValue: "slate",
    fallbackThemeColor: "#f1f5f9",
  },
  ocean: {
    id: "ocean",
    label: "Ocean",
    datasetValue: "ocean",
    fallbackThemeColor: "#eef8ff",
  },
};

function isPfThemeId(value: string | null): value is PfThemeId {
  return value != null && value in PF_THEME_PRESETS;
}

export function getStoredTheme(): PfThemeId {
  try {
    const value = localStorage.getItem(PF_THEME_STORAGE_KEY);
    if (isPfThemeId(value)) return value;
  } catch {
    /* private mode */
  }
  return "default";
}

function resolveThemeColor(root: HTMLElement, fallback: string): string {
  const fromCss = window.getComputedStyle(root).getPropertyValue(PF_THEME_META_COLOR_VAR).trim();
  return fromCss || fallback;
}

/** Aplica `data-pf-theme` en `<html>` y actualiza meta theme-color. */
export function applyTheme(theme: PfThemeId): void {
  const root = document.documentElement;
  const preset = PF_THEME_PRESETS[theme] ?? PF_THEME_PRESETS.default;
  if (preset.datasetValue) root.dataset.pfTheme = preset.datasetValue;
  else delete root.dataset.pfTheme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolveThemeColor(root, preset.fallbackThemeColor));
  }
}

export function applyStoredTheme(): void {
  applyTheme(getStoredTheme());
}

export function persistTheme(theme: PfThemeId): void {
  try {
    if (theme === "default") localStorage.removeItem(PF_THEME_STORAGE_KEY);
    else localStorage.setItem(PF_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}
