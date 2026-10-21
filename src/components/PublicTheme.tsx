"use client";

import { useEffect } from "react";

// Le pagine pubbliche (login, legali, 404…) stanno fuori dal ThemeProvider dell'app: applica la STESSA scelta di tema
// (localStorage "spigolestay:theme", chiaro se assente) alla radice <html>, così i token del prodotto cambiano anche qui
// e anche lo sfondo sotto la pagina e le barre di scorrimento seguono. Alla chiusura toglie la classe (l'app ha la sua).
export default function PublicTheme() {
  useEffect(() => {
    let dark = false;
    try { dark = localStorage.getItem("spigolestay:theme") === "dark"; } catch {}
    const el = document.documentElement;
    if (dark) el.classList.add("dark");
    return () => { el.classList.remove("dark"); };
  }, []);
  return null;
}
