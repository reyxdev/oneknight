import { and, eq, sql as dsql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { products } from "../db/schema.ts";
import { saveImage } from "../files/store.ts";

export { privateAddress, publicFetch } from "../security/public-fetch.ts";
import { publicFetch } from "../security/public-fetch.ts";

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
