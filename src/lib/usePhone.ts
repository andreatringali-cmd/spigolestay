"use client";

import { useEffect, useState } from "react";

// true su telefono (< 640 px, cioè sotto il breakpoint `sm` di Tailwind). Serve quando un controllo con ref/Popover non può
// essere duplicato (barra inline + tendina «Filtri»): lo si monta in un solo posto. Al primo render è false (come il server).
export function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
