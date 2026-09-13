import Image from "next/image";

// Schermata di caricamento mostrata durante il passaggio tra le pagine del gestionale.
export default function Loading() {
  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Image
          src="/xenora-mark.png"
          alt="Xenora"
          width={64}
          height={64}
          priority
          className="animate-pulse object-contain"
          style={{ width: 64, height: 64 }}
        />
        <div className="text-xs font-medium tracking-wide text-faint">Caricamento…</div>
      </div>
    </div>
  );
}
