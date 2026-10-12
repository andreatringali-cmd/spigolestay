// Download della copia di sicurezza (solo browser). Restituisce false se il download non riesce.
import { backupFileName, buildBackupPayload } from "./bulk-guard";

export function downloadBackup(kind: string, items: unknown[]): boolean {
  try {
    const now = new Date();
    const json = JSON.stringify(buildBackupPayload(kind, items, now), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName(kind, now);
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch {
    return false;
  }
}
