// Cattura una o più anteprime A4 (renderizzate off-screen) e le trasforma nel VERO PDF allegato
// all'email — la stessa tecnica già usata per i preventivi (html2canvas+jsPDF), così ogni
// documento generato da Xenora è una fotocopia esatta di quello che si vede a schermo, invece di
// un disegno separato ricostruito a mano (es. con pdf-lib) che rischia di divergere nel tempo.

// Attende che tutte le <img> dentro un contenitore (in particolare il logo) siano caricate prima
// di catturarlo con html2canvas — altrimenti il logo rischia di mancare per un problema di TIMING
// (immagine non ancora decodificata), non di formato. Timeout breve di sicurezza: se un'immagine
// non carica mai (es. URL rotto), non blocchiamo comunque la generazione del PDF.
function waitForImages(container: HTMLElement, timeoutMs = 3000): Promise<void> {
  const imgs = Array.from(container.querySelectorAll("img"));
  if (imgs.length === 0) return Promise.resolve();
  const allLoaded = Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true }); // non blocca: meglio un PDF senza logo che nessun PDF
  }))));
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([allLoaded, timeout]).then(() => undefined);
}

// Converte un Blob in stringa base64 pura (senza il prefisso "data:...;base64,").
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Lettura del PDF fallita"));
    reader.readAsDataURL(blob);
  });
}

// Cattura uno o più contenitori (ciascuno = una pagina A4 già renderizzata a piena risoluzione,
// scale=1, larghezza 794px) e li impagina in un unico PDF A4.
export async function captureA4ToPdfBlob(elements: HTMLDivElement[]): Promise<Blob> {
  if (elements.length === 0) throw new Error("Nessuna pagina da catturare");
  // Import dinamico: librerie pure client-side, mai eseguite lato server (route API).
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  // Aspetta un frame perché React committi il DOM (props appena aggiornate) prima di leggerlo —
  // evita la race fra render e cattura.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    await waitForImages(el);
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    if (i > 0) doc.addPage();
    doc.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
  }
  return doc.output("blob");
}
