"use client";

// Hub Booking Engine: raccoglie in un posto le impostazioni sparse (sconti, bambini/occupazione,
// testi & contenuti), con riepilogo e scorciatoia al punto giusto. Niente duplicazione dei dati.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/store";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { loadPromos } from "@/lib/promos";

export default function BookingEngineHub() {
  const router = useRouter();
  const { structures, roomTypes, activeStructureId } = useData();
  const [promoCount, setPromoCount] = useState(0);
  const [tagline, setTagline] = useState("");

  useEffect(() => {
    try { setPromoCount(loadPromos().filter((p) => p.discountPct && p.code).length); } catch {}
    try { const r = localStorage.getItem("spigolestay:sito"); if (r) setTagline(JSON.parse(r).tagline || ""); } catch {}
  }, []);

  const sid = activeStructureId !== "all" ? activeStructureId : structures[0]?.id;
  const types = useMemo(() => roomTypes.filter((rt) => rt.structureId === sid && !rt.deriveFrom), [roomTypes, sid]);
  const maxOcc = Math.max(0, ...types.map((rt) => rt.maxOccupancy ?? rt.beds ?? 0));
  const childrenOk = types.some((rt) => rt.childrenAllowed !== false);

  const Tile = ({ title, desc, value, action, onClick }: { title: string; desc: string; value: string; action: string; onClick: () => void }) => (
    <Card className="flex flex-col">
      <SectionTitle>{title}</SectionTitle>
      <p className="mt-1 text-xs text-dim">{desc}</p>
      <div className="mt-2 flex-1 text-sm font-semibold text-txt">{value}</div>
      <button onClick={onClick} className="mt-3 self-start rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-txt hover:bg-wash">{action} →</button>
    </Card>
  );

  return (
    <div>
      <PageHeader title="Booking Engine" subtitle="Impostazioni del motore di prenotazione, in un unico posto" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile title="Sconti e offerte" desc="Codici sconto e promozioni mostrati nel motore e nel Xenosite." value={promoCount > 0 ? `${promoCount} offerte attive` : "Nessuna offerta attiva"} action="Gestisci promozioni" onClick={() => router.push("/promozioni")} />
        <Tile title="Bambini e occupazione" desc="Ospiti massimi e regole bambini per tipologia." value={`Max ${maxOcc || "—"} ospiti · bambini ${childrenOk ? "ammessi" : "non ammessi"}`} action="Apri Camere" onClick={() => router.push("/camere")} />
        <Tile title="Testi e contenuti" desc="Sottotitolo, foto, sezioni e lingue del mini-sito." value={tagline ? `“${tagline}”` : "Sottotitolo non impostato"} action="Apri Xenosite" onClick={() => router.push("/sito")} />
        <Tile title="Widget del sito" desc="Il modulo di prenotazione da incollare sul tuo sito." value="Layout, tema, CSS" action="Apri Widget" onClick={() => router.push("/widget")} />
        <Tile title="Extra e upselling" desc="Servizi extra proposti in prenotazione." value="Transfer, colazione, late check-out…" action="Apri Upselling" onClick={() => router.push("/upselling")} />
        <Tile title="Pagamenti e acconti" desc="Acconto richiesto e metodi di pagamento." value="Stripe, % acconto" action="Apri Strutture" onClick={() => router.push("/strutture")} />
      </div>
      <p className="mt-3 text-xs text-faint">Questa pagina raccoglie le impostazioni: i dati restano nei rispettivi moduli, senza doppioni.</p>
    </div>
  );
}
