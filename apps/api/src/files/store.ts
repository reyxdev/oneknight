import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { db } from "../db/client.ts";
import { files } from "../db/schema.ts";
import { env } from "../config.ts";

const MAX_BYTES = 4 * 1024 * 1024;
const root = path.resolve(env.UPLOAD_DIR);

/** Images are accepted by content (magic bytes), never by the name or the declared type. */
function sniff(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Upload payload inside JSON: { name, data } where data is base64 or a data: URL. */
export const Upload = z.object({ name: z.string().max(200).optional(), data: z.string().max(Math.ceil((MAX_BYTES * 4) / 3) + 100) });
export type UploadInput = z.infer<typeof Upload>;

export async function saveImage(input: UploadInput, opts: { organizationId: string | null; uploaderId: string | null; isPublic?: boolean }) {
  const b64 = input.data.replace(/^data:[^;]+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length || buf.length > MAX_BYTES) return { ok: false as const, error: "file_too_large" };
  const mime = sniff(buf);
  if (!mime) return { ok: false as const, error: "unsupported_file" };
  const storageKey = `${randomBytes(16).toString("hex")}.${mime.split("/")[1]}`;
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, storageKey), buf, { flag: "wx" });
  const [f] = await db.insert(files).values({ organizationId: opts.organizationId, uploaderId: opts.uploaderId, mime, size: buf.length, storageKey, isPublic: opts.isPublic ?? false }).returning();
  return { ok: true as const, file: f! };
}

export async function readStored(storageKey: string) {
  if (!/^[0-9a-f]{32}\.(png|jpeg|webp)$/.test(storageKey)) throw new Error("bad key");
  return readFile(path.join(root, storageKey));
}

/** Deletes files on disk that no database row points to (e.g. after an organization was deleted). */
export async function sweepOrphans(): Promise<number> {
  const { readdir, unlink, stat } = await import("node:fs/promises");
  const names = await readdir(root).catch(() => [] as string[]);
  if (!names.length) return 0;
  const known = new Set((await db.select({ k: files.storageKey }).from(files)).map((r) => r.k));
  let removed = 0;
  for (const n of names) {
    if (known.has(n) || !/^[0-9a-f]{32}\.(png|jpeg|webp)$/.test(n)) continue;
    // Skip files younger than an hour: their row may still be inserting.
    const s = await stat(path.join(root, n)).catch(() => null);
    if (!s || Date.now() - s.mtimeMs < 3600_000) continue;
    await unlink(path.join(root, n)).catch(() => {});
    removed++;
  }
  return removed;
}
