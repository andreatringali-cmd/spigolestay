"use client";

// Card compatta in Dashboard: sintesi adempimenti di oggi con link alla pagina.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useData } from "@/lib/store";

const today = () => new Date().toISOString().slice(0, 10);

export default function AdempimentiCard() {
  const router = useRouter();
  const { bookings } = useData();
  const [sched, setSched] = useState(0);
  const [istat, setIstat] = useState(0);
  const [rejected, setRejected] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const t = today();
      const [a, i, d] = await Promise.all([
        supabase.from("alloggiati_schedine").select("id", { count: "exact", head: true }).neq("stato", "inviata").lte("arrival", t),
        supabase.from("istat_rows").select("id", { count: "exact", head: true }).eq("stato", "pending"),
        supabase.from("documents").select("id", { count: "exact", head: true }).eq("stato", "scartata"),
      ]);
      setSched(a.count ?? 0); setIstat(i.count ?? 0); setRejected(d.count ?? 0);
    })();
  }, []);

  const t = today();
  const noCheckin = bookings.filter((b) => b.checkIn === t && b.status !== "cancelled" && b.channel !== "blocked" && !b.webCheckin).length;
  const items = [
    { n: noCheckin, l: "check-in mancanti", tone: "var(--warn)" },
    { n: sched, l: "schedine 24h", tone: "var(--err)" },
    { n: istat, l: "ISTAT", tone: "var(--warn)" },
    { n: rejected, l: "scartati", tone: "var(--err)" },
  ].filter((x) => x.n > 0);

  return (
    <button onClick={() => router.push("/adempimenti")} className="mb-4 flex w-full flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-left shadow-sm hover:shadow-md">
      <span className="text-sm font-bold text-txt">Adempimenti oggi</span>
      {items.length === 0
        ? <span className="text-sm font-medium text-[color:var(--ok)]">✓ tutto in ordine</span>
        : items.map((x) => <span key={x.l} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: `color-mix(in srgb, ${x.tone} 16%, transparent)`, color: x.tone }}>{x.n} {x.l}</span>)}
      <span className="ml-auto text-xs font-semibold text-focus">Apri →</span>
    </button>
  );
}
