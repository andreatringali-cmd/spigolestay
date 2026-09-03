"use client";

import { PageHeader, Card } from "@/components/ui";
import { useLang } from "@/lib/i18n";

export default function LeiaPage() {
  const { t } = useLang();
  return (
    <div>
      <PageHeader title="Leia" subtitle={t("Assistente — in preparazione")} />
      <Card>
        <div className="py-10 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[color:color-mix(in_srgb,var(--focus)_14%,transparent)] text-focus">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.6 4.9L18.5 9.5l-4.9 1.6L12 16l-1.6-4.9L5.5 9.5l4.9-1.6z" /><path d="M19 15l.6 1.9L21.5 17.5l-1.9.6L19 20l-.6-1.9L16.5 18.1l1.9-.6z" /></svg>
          </div>
          <div className="font-display text-lg font-bold text-txt">Leia</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-dim">{t("Questa sezione è pronta per essere configurata. Dimmi cosa deve fare Leia.")}</p>
        </div>
      </Card>
    </div>
  );
}
