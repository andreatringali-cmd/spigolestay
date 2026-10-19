"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DataProvider } from "@/lib/store";
import { AuthProvider } from "@/lib/authsync";
import { ThemeProvider } from "@/lib/theme";
import { LangProvider } from "@/lib/i18n";
import { AccessProvider } from "@/lib/access";
import { ConfirmProvider } from "./ConfirmProvider";
import { ToastProvider } from "./ToastProvider";
import AutopilotRunner from "./AutopilotRunner";
import ChannexAutoSync from "./ChannexAutoSync";
import MediaMigrator from "./MediaMigrator";
import BookingHealer from "./BookingHealer";
import Sidebar from "./Sidebar";
import Icon from "./Icon";
import BookingDrawer from "./BookingDrawer";
import NewBookingModal from "./NewBookingModal";
import SupportWidget from "./SupportWidget";
import StructureSwitcher from "./StructureSwitcher";
import OnlineUsers from "./OnlineUsers";
import ActivityLog from "./ActivityLog";
import SoundToggle from "./SoundToggle";
import LanguageSwitcher from "./LanguageSwitcher";
import AccessGate from "./AccessGate";
import AppFooter from "./AppFooter";
import AssistantBar from "./AssistantBar";
import StyleLoader from "./StyleLoader";
import OnboardingWizard from "./OnboardingWizard";
import CollaboratorSync from "./CollaboratorSync";
import WorkspaceSync from "./WorkspaceSync";
import IdleLogout from "./IdleLogout";
import PendingInvite from "./PendingInvite";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Cambiata pagina (anche da un link che non è nel menu) il cassetto del telefono si richiude.
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  // Sotto i 768px il menu è un cassetto: "compresso" vale solo dal tablet in su (piegando un telefono il cassetto restava a sole icone) e il cassetto si chiude da solo.
  const [isMd, setIsMd] = useState(() => (typeof window === "undefined" ? true : window.matchMedia("(min-width: 768px)").matches));
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => { setIsMd(mq.matches); if (mq.matches) setMobileOpen(false); };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <AuthProvider>
    <ThemeProvider>
      <LangProvider>
      <DataProvider>
        <AccessProvider>
        <ConfirmProvider>
        <ToastProvider>
        <AutopilotRunner />
        <ChannexAutoSync />
        <MediaMigrator />
        <BookingHealer />
        <PendingInvite />
        <StyleLoader />
        <div className="relative min-h-dvh bg-paper text-txt">
          <div className="relative z-10 flex min-h-dvh">
          <Sidebar
            pathname={pathname}
            collapsed={collapsed && isMd}
            onToggleCollapse={() => setCollapsed((c) => !c)}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Barra superiore: menu (mobile) + ricerca globale al centro. Nessun menu orizzontale. */}
            <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4">
              <button onClick={() => setMobileOpen(true)} aria-label="Menu" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-dim hover:bg-wash hover:text-txt md:hidden">
                <Icon name="menu" size={18} />
              </button>
              <AssistantBar />
              <div className="ml-auto flex items-center gap-2">
                {/* Secondari: nascosti sul telefono per non affollare la barra (visibili da tablet in su). */}
                <div className="hidden items-center gap-2 sm:flex">
                  <OnlineUsers />
                  <ActivityLog />
                  <SoundToggle />
                  <LanguageSwitcher />
                </div>
                <StructureSwitcher />
              </div>
            </header>
            <main className="w-full flex-1 px-4 py-6 md:px-6"><AccessGate>{children}</AccessGate></main>
            <AppFooter />
          </div>
          </div>

          <BookingDrawer />
          <NewBookingModal />
          <SupportWidget />
          <OnboardingWizard />
          <CollaboratorSync />
          <WorkspaceSync />
          <IdleLogout />
        </div>
        </ToastProvider>
        </ConfirmProvider>
        </AccessProvider>
      </DataProvider>
      </LangProvider>
    </ThemeProvider>
    </AuthProvider>
  );
}
