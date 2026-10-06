import { NextResponse } from "next/server";
import { requireUser, isErr } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quali invii automatici sono ACCESI sul server. Serve alle schede prenotazione per dire "invio previsto alle 10:00" solo quando l'invio
// parte davvero, e "invio automatico in pausa" quando l'interruttore è spento. Non espone nessun valore segreto: solo due sì/no.
export async function GET(req: Request) {
  const who = await requireUser(req);
  if (isErr(who)) return who;
  return NextResponse.json({
    messagesLive: process.env.AUTO_MESSAGES_LIVE === "1",
    alloggiatiLive: process.env.ALLOGGIATI_LIVE === "1",
  });
}
