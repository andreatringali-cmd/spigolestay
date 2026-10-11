import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import InviiAvviso from "@/components/InviiAvviso";

export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell><InviiAvviso />{children}</AppShell>;
}
