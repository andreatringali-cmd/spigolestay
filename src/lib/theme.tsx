"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "light", setTheme: () => {} });

// Provider del tema chiaro/scuro: applica la classe `dark` alla radice dell'app e
// persiste la scelta in localStorage. Pilotabile da qualsiasi punto via useTheme().
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => {
    try { const t = localStorage.getItem("spigolestay:theme"); if (t === "dark" || t === "light") setThemeState(t); } catch {}
  }, []);
  const setTheme = (t: Theme) => { setThemeState(t); try { localStorage.setItem("spigolestay:theme", t); } catch {} };
  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
      <div className={theme === "dark" ? "dark" : ""}>{children}</div>
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
