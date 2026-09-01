"use client";

import { useEffect } from "react";
import { loadAndApplyStyle } from "@/lib/appstyle";

// Applica lo stile salvato (palette + struttura box) all'avvio, su tutte le pagine.
export default function StyleLoader() {
  useEffect(() => { loadAndApplyStyle(); }, []);
  return null;
}
