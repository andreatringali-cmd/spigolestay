"use client";

// Gli adempimenti di oggi ora vivono nella Dashboard: questa vecchia rotta reindirizza lì,
// così eventuali link salvati/segnalibri continuano a funzionare.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdempimentiRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return null;
}
