"use client";

// Modelli & automazioni → «Messaggi dei pulsanti»: i testi che Xenora prepara quando premi un pulsante (invito al check-in, link di pagamento,
// promemoria di partenza, conto, recensione…). Ogni testo è modificabile, per lingua; «Ripristina» torna al testo predefinito.
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, SectionTitle, Button } from "@/components/ui";
import { useLang } from "@/lib/i18n";
import VarLegend from "@/components/VarLegend";
import { MSG_LANGS, MSG_LANG_LABEL, MSG_OVERRIDES_EVENT, SYSTEM_MESSAGES, loadOverrides, saveOverride, type MsgLang, type OverrideMap, type SystemMessageDef } from "@/lib/msg-overrides";

export default function SystemMessagesCard() {
  const { t } = useLang();
  const [open, setOpen] = useState(true); // aperta: l'elenco dei messaggi si vede subito
  const [openId, setOpenId] = useState<string | null>(null);
  const [lang, setLang] = useState<MsgLang>("it");
  const [over, setOver] = useState<OverrideMap>({});
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const reload = useCallback(() => setOver(loadOverrides()), []);
  useEffect(() => {
    reload();
    window.addEventListener(MSG_OVERRIDES_EVENT, reload);
    return () => window.removeEventListener(MSG_OVERRIDES_EVENT, reload);
  }, [reload]);

  const isEdited = (m: SystemMessageDef) => MSG_LANGS.some((l) => !!over[m.id]?.[l]);
  const textOf = (m: SystemMessageDef, l: MsgLang) => over[m.id]?.[l] ?? m.texts[l];
  const change = (m: SystemMessageDef, l: MsgLang, value: string) => saveOverride(m.id, l, value === m.texts[l] ? null : value); // uguale al predefinito = nessuna modifica

  const insert = (m: SystemMessageDef, token: string) => {
    const el = areaRef.current;
    const cur = textOf(m, lang);
    if (!el) { change(m, lang, cur + token); return; }
    const a = el.selectionStart ?? cur.length, b = el.selectionEnd ?? cur.length;
    change(m, lang, cur.slice(0, a) + token + cur.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length); });
  };

  const edited = SYSTEM_MESSAGES.filter(isEdited).length;

  return (
    <Card className="p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left">
        <span>
          <SectionTitle>{t("Messaggi dei pulsanti")}</SectionTitle>
          <span className="mt-0.5 block text-xs text-dim">{t("I testi che Xenora prepara quando premi un pulsante (check-in, link di pagamento, partenza, conto, recensione). Puoi cambiarli.")}{edited > 0 ? ` · ${edited} ${t("modificati")}` : ""}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-dim transition-transform ${open ? "" : "-rotate-90"}`}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <ul className="mt-3 flex flex-col gap-2">
          {SYSTEM_MESSAGES.map((m) => {
            const isOpen = openId === m.id;
            const langEdited = !!over[m.id]?.[lang];
            return (
              <li key={m.id} className="rounded-xl border border-line">
                <button type="button" onClick={() => setOpenId(isOpen ? null : m.id)} aria-expanded={isOpen} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-txt">{t(m.name)}{isEdited(m) && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--focus) 14%, transparent)", color: "var(--focus)" }}>{t("Modificato")}</span>}</span>
                    <span className="block text-[11px] text-dim">{t(m.when)}</span>
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`mt-1 shrink-0 text-dim transition-transform ${isOpen ? "" : "-rotate-90"}`}><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {isOpen && (
                  <div className="border-t border-line p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1">
                      {MSG_LANGS.map((l) => (
                        <button key={l} type="button" onClick={() => setLang(l)} className={`rounded-md px-2 py-1 text-xs font-medium ${lang === l ? "bg-focus text-on-focus" : "text-dim hover:bg-wash"}`}>{MSG_LANG_LABEL[l]}{over[m.id]?.[l] ? " •" : ""}</button>
                      ))}
                    </div>
                    <textarea ref={areaRef} value={textOf(m, lang)} onChange={(e) => change(m, lang, e.target.value)} rows={m.id === "review" || m.id === "bill" ? 9 : 5} aria-label={`${t(m.name)} · ${MSG_LANG_LABEL[lang]}`} className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-txt outline-none focus:border-focus" />
                    {m.vars.length > 0 && <div className="mt-2"><VarLegend vars={m.vars.map((v) => ({ token: `{${v.key}}`, desc: v.hint }))} onInsert={(tok) => insert(m, tok)} /></div>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-[11px] text-faint">{t("Se togli un segnaposto, quella parte non compare nel messaggio.")}</p>
                      <Button variant="secondary" size="xs" type="button" disabled={!langEdited} onClick={() => saveOverride(m.id, lang, null)}>{t("Ripristina il testo predefinito")}</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
