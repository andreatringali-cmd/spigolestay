// Stato vuoto con il marchio Xenora (come le pagine "archivio" vuote di Octorate).
export default function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/xenora-mark.png" alt="" width={52} height={52} className="h-13 w-13 opacity-25" style={{ height: 52, width: 52 }} />
      <div className="mt-1 text-sm font-medium text-dim">{title}</div>
      {sub && <div className="max-w-sm text-xs text-faint">{sub}</div>}
    </div>
  );
}
