"use client";

import { useState, type ReactNode } from "react";
import { Card, SectionTitle } from "./ui";
import Icon from "./Icon";

export interface ChartItem {
  key: string;
  title: string;
  node: ReactNode;
}

// Galleria grafici: mostra `perPage` grafici alla volta, con frecce per scorrere.
export default function ChartGallery({ charts, perPage = 4 }: { charts: ChartItem[]; perPage?: number }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(charts.length / perPage));
  const p = Math.min(page, pages - 1);
  const shown = charts.slice(p * perPage, p * perPage + perPage);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-surface p-3 shadow-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">Grafici</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-dim">{p + 1} / {pages}</span>
          <button onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0} className="rounded-lg border border-line p-1.5 text-dim enabled:hover:bg-wash enabled:hover:text-txt disabled:opacity-40">
            <span className="block rotate-180"><Icon name="chevron" size={16} /></span>
          </button>
          <button onClick={() => setPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1} className="rounded-lg border border-line p-1.5 text-dim enabled:hover:bg-wash enabled:hover:text-txt disabled:opacity-40">
            <Icon name="chevron" size={16} />
          </button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((c) => (
          <Card key={c.key}>
            <SectionTitle>{c.title}</SectionTitle>
            {c.node}
          </Card>
        ))}
      </div>
    </div>
  );
}
