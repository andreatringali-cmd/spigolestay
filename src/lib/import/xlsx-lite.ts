// Lettore minimo di file Excel (.xlsx; Octorate li esporta con estensione .xls ma sono .xlsx): solo il primo foglio, come tabella di testo.
// Nessuna dipendenza: lo xlsx è un archivio zip; i file si decomprimono con DecompressionStream ("deflate-raw"), disponibile nei browser e in Node.

const u16 = (d: DataView, o: number) => d.getUint16(o, true);
const u32 = (d: DataView, o: number) => d.getUint32(o, true);

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Legge i file che servono di uno zip (nome → contenuto non compresso). */
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  // Fine della directory centrale (EOCD): firma 0x06054b50, cercata dalla fine.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("File Excel non valido.");
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(view, p) !== 0x02014b50) break;
    const method = u16(view, p + 10);
    const csize = u32(view, p + 20);
    const nlen = u16(view, p + 28), elen = u16(view, p + 30), clen = u16(view, p + 32);
    const lho = u32(view, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!/^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml)$/.test(name)) continue;
    const dataStart = lho + 30 + u16(view, lho + 26) + u16(view, lho + 28);
    const raw = bytes.subarray(dataStart, dataStart + csize);
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
  }
  return out;
}

const colIndex = (ref: string) => { const m = ref.match(/^([A-Z]+)/); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const unesc = (x: string) => x
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
// Testo di un nodo: unisce i <t>…</t> (anche con rich text), senza dipendere da DOMParser.
const textOf = (xml: string) => Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)).map((m) => unesc(m[1])).join("");

/** Prima tabella del file come righe di testo (la riga 0 è l'intestazione). */
export async function readXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const dec = new TextDecoder();
  const read = (name: string) => { const f = files.get(name); return f ? dec.decode(f) : ""; };
  const sst = Array.from(read("xl/sharedStrings.xml").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)).map((m) => textOf(m[1]));
  const sheetName = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort()[0];
  const xml = sheetName ? read(sheetName) : "";
  if (!xml) throw new Error("Nessun foglio trovato nel file Excel.");
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const r: string[] = [];
    for (const c of row[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const idx = colIndex((attrs.match(/\br="([A-Z]+\d+)"/) || [])[1] || "A1");
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const inner = c[2] ?? "";
      let v = "";
      if (t === "inlineStr") v = textOf(inner);
      else {
        const raw = unesc((inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/) || [])[1] ?? "");
        v = t === "s" ? (sst[parseInt(raw, 10)] ?? "") : raw;
      }
      r[idx] = v;
    }
    for (let i = 0; i < r.length; i++) if (r[i] === undefined) r[i] = "";
    rows.push(r);
  }
  return rows;
}
