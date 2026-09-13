import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

// Risolve un link corto /g/<code> e reindirizza alla guida completa.
// Solo target che iniziano con /guida/ (niente open redirect).
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const fallback = new URL("/guida/index.html", req.url);
  if (!supabase || !code) return NextResponse.redirect(fallback, 302);
  try {
    const { data } = await supabase.from("short_links").select("target").eq("code", code).maybeSingle();
    const target = data?.target;
    if (target && target.startsWith("/guida/")) return NextResponse.redirect(new URL(target, req.url), 302);
  } catch {}
  return NextResponse.redirect(fallback, 302);
}
