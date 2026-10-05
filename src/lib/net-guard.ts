// Protezione SSRF: impedisce che il server scarichi indirizzi interni/privati (rete di Vercel, metadata cloud, localhost…),
// anche quando il nome host sembra innocuo ma punta a un IP privato (DNS), o con redirect.
import { promises as dns } from "dns";
import { isIP } from "net";

function v4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;       // "questa rete", privata, loopback, multicast/riservati
  if (a === 100 && b >= 64 && b <= 127) return true;                    // CGNAT
  if (a === 169 && b === 254) return true;                              // link-local (metadata cloud 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || (b === 0 && ip.startsWith("192.0.0.")))) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;                 // benchmark
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind === 6) {
    const low = ip.toLowerCase();
    if (low === "::" || low === "::1") return true;
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);            // IPv4 dentro IPv6
    if (mapped) return v4Private(mapped[1]);
    const mappedHex = low.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) { const n = (parseInt(mappedHex[1], 16) << 16) | parseInt(mappedHex[2], 16); return v4Private([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".")); }
    if (/^f[cd]/.test(low) || /^fe[89ab]/.test(low)) return true;           // unique-local e link-local
    return false;
  }
  return true; // non è un IP valido: nel dubbio no
}

/** Vero se l'host è ammesso: non interno e (risolto via DNS) senza indirizzi privati. */
export async function isPublicHost(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return false;
  if (isIP(h)) return !isPrivateIp(h);
  try {
    const addrs = await dns.lookup(h, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch { return false; }
}
