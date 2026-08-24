"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DataProvider } from "@/lib/store";
import { ThemeProvider } from "@/lib/theme";
import { LangProvider } from "@/lib/i18n";
import { AccessProvider } from "@/lib/access";
import { ConfirmProvider } from "./ConfirmProvider";
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

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ThemeProvider>
      <LangProvider>
      <DataProvider>
        <AccessProvider>
        <ConfirmProvider>
        <div className="relative min-h-screen bg-paper text-txt">
          <div className="relative z-10 flex min-h-screen">
          <Sidebar
            pathname={pathname}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Barra superiore: menu (mobile) + ricerca globale al centro. Nessun menu orizzontale. */}
            <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
              <button onClick={() => setMobileOpen(true)} className="rounded-lg p-1.5 text-dim hover:bg-wash hover:text-txt md:hidden">
                <Icon name="menu" size={18} />
              </button>
              <AssistantBar />
              <div className="ml-auto flex items-center gap-2">
                <OnlineUsers />
                <ActivityLog />
                <SoundToggle />
                <LanguageSwitcher />
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
        </div>
        </ConfirmProvider>
        </AccessProvider>
      </DataProvider>
      </LangProvider>
    </ThemeProvider>
  );
}
