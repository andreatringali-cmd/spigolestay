"use client";

import { Button } from "@/components/ui";
import { useEffect, useState } from "react";
import { isSoundOn, setSoundOn, playSound } from "@/lib/sound";
import { useLang } from "@/lib/i18n";

export default function SoundToggle() {
  const { t } = useLang();
  const [on, setOn] = useState(true);
  useEffect(() => { setOn(isSoundOn()); }, []);
  const toggle = () => { const v = !on; setOn(v); setSoundOn(v); if (v) playSound("notify"); };
  return (
    <Button variant="secondary" size="xs" onClick={toggle} title={on ? t("Suoni attivi") : t("Suoni disattivati")} aria-label={t("Attiva/disattiva suoni")} className="w-8 !px-0 max-sm:w-10 max-sm:!px-0">
      {on ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></svg>
      )}
    </Button>
  );
}
