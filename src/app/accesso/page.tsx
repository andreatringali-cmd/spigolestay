import type { Metadata } from "next";
import AccessoForm from "./AccessoForm";
import PublicThemeBoot from "@/components/PublicThemeBoot";

export const metadata: Metadata = { title: "Scegli la password · Xenora", robots: { index: false, follow: false } };

export default function AccessoPage() {
  return <><PublicThemeBoot /><AccessoForm /></>;
}
