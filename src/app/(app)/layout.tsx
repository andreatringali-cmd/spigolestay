import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import InviiAvviso from "@/components/InviiAvviso";
import OpenBookingFromUrl from "@/components/OpenBookingFromUrl";

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell><InviiAvviso /><OpenBookingFromUrl />{children}</AppShell>;
}
