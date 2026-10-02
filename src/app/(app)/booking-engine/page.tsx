"use client";

// Hub Booking Engine: raccoglie in un posto le impostazioni sparse (sconti, bambini/occupazione,
// testi & contenuti), con riepilogo e scorciatoia al punto giusto. Niente duplicazione dei dati.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { PageHeader, Card } from "@/components/ui";
import { loadPromos, promosForStructure } from "@/lib/promos";
import { getSiteConfigRaw } from "@/lib/publicdata";
import Icon from "@/components/Icon";

export default function BookingEngineHub() {
  const router = useRouter();
  const { structures, roomTypes, activeStructureId } = useData();
  const [promoCount, setPromoCount] = useState(0);
  const [tagline, setTagline] = useState("");
  const [guideSections, setGuideSections] = useState<number | null>(null);

  const sid = activeStructureId !== "all" ? activeStructureId : structures[0]?.id;

  useEffect(() => {
    // Offerte della struttura in vista (+ quelle valide per tutte); con "Tutte" si contano tutte.
    try { setPromoCount(promosForStructure(loadPromos(), activeStructureId).filter((p) => p.discountPct && p.code).length); } catch {}
    try {
      // Config del mini-sito SCOPED per struttura (vedi src/lib/publicdata.ts): il
      // tagline mostrato qui deve seguire la struttura attiva, non una chiave globale.
      const r = sid ? getSiteConfigRaw(sid, structures[0]?.id) : null;
      setTagline(r ? JSON.parse(r).tagline || "" : "");
    } catch {}
    try {
      const all = JSON.parse(localStorage.getItem("spigolestay:guides") || "{}");
      const sections = sid ? all[sid]?.content?.sections : undefined;
      setGuideSections(Array.isArray(sections) ? sections.filter((s: { intro?: string; photos?: unknown[] }) => s.intro?.trim() || s.photos?.length).length : 0);
    } catch { setGuideSections(0); }
  }, [sid, structures, activeStructureId]);
  const types = useMemo(() => roomTypes.filter((rt) => rt.structureId === sid && !rt.deriveFrom), [roomTypes, sid]);
  const maxOcc = Math.max(0, ...types.map((rt) => rt.maxOccupancy ?? rt.beds ?? 0));
  const childrenOk = types.some((rt) => rt.childrenAllowed !== false);

  const Tile = ({ icon, tint, title, desc, value, action, onClick }: { icon: string; tint: string; title: string; desc: string; value: string; action: string; onClick: () => void }) => (
    <Card className="group flex flex-col">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint }}>
          <Icon name={icon} size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-txt">{title}</div>
          <p className="mt-0.5 text-xs leading-snug text-dim">{desc}</p>
        </div>
      </div>
      <div className="mt-3 flex-1 rounded-lg bg-wash px-3 py-2 text-sm text-txt">{value}</div>
      <button onClick={onClick} className="mt-3 inline-flex items-center gap-1 self-start text-xs font-semibold transition group-hover:gap-1.5" style={{ color: tint }}>
        {action} <span aria-hidden>→</span>
      </button>
    </Card>
  );

  return (
    <div>
      <PageHeader title="Booking Engine" subtitle="Impostazioni del motore di prenotazione, in un unico posto" />
      {activeStructureId === "all" && structures.length > 1 && (
        <p className="mb-3 rounded-lg border border-line bg-wash px-3 py-2 text-xs text-dim">Con «Tutte le strutture» qui sotto vedi i dati di <b className="text-txt">{structures.find((s) => s.id === sid)?.name}</b>: seleziona una struttura in alto a destra per vedere e modificare le impostazioni di un&apos;altra.</p>
      )}
      {/* Ordine delle card = ordine delle voci "Booking Engine" nella sidebar (vedi nav.ts):
          Widget sito, Xenosite, Promozioni, Upselling, Guida ospiti prima; le due impostazioni
          che vivono altrove (Camere, Strutture) in coda, non essendo voci di questo gruppo. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile icon="eye" tint="#0E7C66" title="Widget del sito" desc="Il modulo di prenotazione da incollare sul tuo sito." value="Layout, tema, CSS" action="Apri Widget" onClick={() => router.push("/widget")} />
        <Tile icon="fileText" tint="#C08A3A" title="Testi e contenuti" desc="Sottotitolo, foto, sezioni e lingue del mini-sito." value={tagline ? `"${tagline}"` : "Sottotitolo non impostato"} action="Apri Xenosite" onClick={() => router.push("/sito")} />
        <Tile icon="tag" tint="#5B74E6" title="Sconti e offerte" desc="Codici sconto e promozioni mostrati nel motore e nel Xenosite." value={promoCount > 0 ? `${promoCount} offerte attive` : "Nessuna offerta attiva"} action="Gestisci promozioni" onClick={() => router.push("/promozioni")} />
        <Tile icon="sparkles" tint="#B3453A" title="Extra e upselling" desc="Servizi extra proposti in prenotazione." value="Transfer, colazione, late check-out…" action="Apri Upselling" onClick={() => router.push("/upselling")} />
        <Tile icon="share" tint="#0891B2" title="Guida personalizzata" desc="La guida digitale che l'ospite vede dopo la prenotazione." value={guideSections === null ? "—" : guideSections > 0 ? `${guideSections} sezioni personalizzate` : "Guida non ancora personalizzata"} action="Apri Guida ospiti" onClick={() => router.push("/guida-ospiti")} />
        <Tile icon="users" tint="#4F8A5B" title="Bambini e occupazione" desc="Ospiti massimi e regole bambini per tipologia." value={`Max ${maxOcc || "—"} ospiti · bambini ${childrenOk ? "ammessi" : "non ammessi"}`} action="Apri Camere" onClick={() => router.push("/camere")} />
        <Tile icon="card" tint="#8B5CF6" title="Pagamenti e acconti" desc="Acconto richiesto e metodi di pagamento." value="Stripe, % acconto" action="Apri Strutture" onClick={() => router.push("/strutture")} />
      </div>
      <p className="mt-3 text-xs text-faint">Questa pagina raccoglie le impostazioni: i dati restano nei rispettivi moduli, senza doppioni.</p>
    </div>
  );
}
