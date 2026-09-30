import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { products } from "../db/schema.ts";
import { saveImage } from "../files/store.ts";

/** 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, 0/8, multicast; IPv6 loopback, local and mapped v4. */
export function privateAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

/**
 * Downloads a public file for an import (a YML catalogue, a product picture): http(s) on public hosts only, every
 * redirect checked again, a size limit and a timeout. The server never reaches its own network this way.
 */
export async function publicFetch(url: string, maxBytes: number): Promise<Buffer> {
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(target);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad_url");
    if (u.username || u.password || isIP(u.hostname.replace(/^\[|\]$/g, ""))) throw new Error("bad_url");
    const addrs = await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new Error("bad_url");
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "ONEKNIGHT-Import/1.0 (+https://oneknight.pro)" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      target = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`http_${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new Error("file_too_large");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error("file_too_large");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("too_many_redirects");
}

let running = false;
/**
 * Pictures left by an import: downloaded in the background, a few products at a time, into the product's gallery.
 * A link that fails is dropped (the import result already said photos load later).
 */
export async function downloadPendingPhotos(fetchFile: (url: string) => Promise<Buffer> = (u) => publicFetch(u, 4 * 1024 * 1024), orgId?: string) {
  if (running) return 0;
  running = true;
  let saved = 0;
  try {
    for (;;) {
      const batch = await db
        .select({ id: products.id, org: products.organizationId, pending: products.pendingPhotos, photos: products.photos })
        .from(products)
        .where(and(dsql`cardinality(${products.pendingPhotos}) > 0`, orgId ? eq(products.organizationId, orgId) : undefined))
        .limit(20);
      if (!batch.length) break;
      for (const p of batch) {
        const ids: string[] = [];
        for (const url of p.pending.slice(0, 10)) {
          const buf = await fetchFile(url).catch(() => null);
          if (!buf) continue;
          const f = await saveImage({ data: buf.toString("base64") }, { organizationId: p.org, uploaderId: null, isPublic: true });
          if (f.ok) ids.push(f.file.id), saved++;
        }
        await db
          .update(products)
          .set({ pendingPhotos: [], photos: [...p.photos, ...ids], photoFileId: [...p.photos, ...ids][0] ?? null })
          .where(eq(products.id, p.id));
      }
    }
  } finally {
    running = false;
  }
  return saved;
}
