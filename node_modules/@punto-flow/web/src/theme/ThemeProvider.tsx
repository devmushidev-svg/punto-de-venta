import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { applyTheme, getStoredTheme, persistTheme, type PfThemeId } from "./pfTheme";

type Ctx = { theme: PfThemeId; setTheme: (t: PfThemeId) => void };

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<PfThemeId>(() => getStoredTheme());

  const setTheme = useCallback((t: PfThemeId) => {
    persistTheme(t);
    applyTheme(t);
    setThemeState(t);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function usePfTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("usePfTheme debe usarse dentro de ThemeProvider");
  return ctx;
}
