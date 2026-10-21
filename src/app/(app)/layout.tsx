import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import InviiAvviso from "@/components/InviiAvviso";
import OpenBookingFromUrl from "@/components/OpenBookingFromUrl";

// Anti-lampeggio del tema scuro: prima del primo paint mette la classe `dark` su <html> (la scelta sta in localStorage).
// Sta qui, nel layout dell'app, e non nella radice: login e pagine pubbliche non hanno il tema scuro e devono restare chiare.
const THEME_BOOT = `try{if(localStorage.getItem("spigolestay:theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      <AppShell><InviiAvviso /><OpenBookingFromUrl />{children}</AppShell>
    </>
  );
}
