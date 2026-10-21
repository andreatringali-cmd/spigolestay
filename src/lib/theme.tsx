"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { applyChannelColorOverrides, CHANNEL_COLORS_EVENT } from "./channelOverrides";

type Theme = "light" | "dark";

const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "light", setTheme: () => {} });

// Provider del tema chiaro/scuro: applica la classe `dark` a <html> e alla radice dell'app e
// persiste la scelta in localStorage. Pilotabile da qualsiasi punto via useTheme().
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [ready, setReady] = useState(false); // la scelta salvata è stata letta: solo da qui in poi si tocca <html>
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { const t = localStorage.getItem("spigolestay:theme"); if (t === "dark" || t === "light") setThemeState(t); } catch {}
    setReady(true);
  }, []);
  // La classe `dark` va ANCHE su <html>: così body, scrollbar, overscroll e controlli nativi seguono il tema (color-scheme).
  // Lo script anti-flash in (app)/layout.tsx l'ha già messa prima del primo paint; qui la si tiene allineata alla scelta
  // e la si toglie uscendo dall'app (login e pagine pubbliche restano chiare).
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme, ready]);
  useEffect(() => () => { document.documentElement.classList.remove("dark"); }, []);
  const setTheme = (t: Theme) => { setThemeState(t); try { localStorage.setItem("spigolestay:theme", t); } catch {} };
  // I colori canale personalizzati (Canali → dettaglio canale) vanno applicati QUI, sullo stesso
  // elemento che porta la classe "dark": un inline style su questo div vince sempre sulla regola
  // ".dark{--ch-...}" per lo stesso elemento, cosa che non varrebbe applicandolo su <html>.
  useEffect(() => {
    if (!rootRef.current) return;
    applyChannelColorOverrides(rootRef.current);
    const onChange = () => { if (rootRef.current) applyChannelColorOverrides(rootRef.current); };
    window.addEventListener(CHANNEL_COLORS_EVENT, onChange);
    return () => window.removeEventListener(CHANNEL_COLORS_EVENT, onChange);
  }, [theme]);
  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
      <div ref={rootRef} className={theme === "dark" ? "dark" : ""}>{children}</div>
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
