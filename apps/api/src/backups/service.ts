import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { and, asc, desc, eq, gt, inArray, notInArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { backups, files, productCategories, integrations, ledgerEntries, memberships, moduleInstalls, orderEvents, orders, organizations, products, reviews, sites, subscriptions, ticketMessages, tickets, users } from "../db/schema.ts";
import { env } from "../config.ts";
import { readStored } from "../files/store.ts";

const gz = promisify(gzip);
const dir = path.resolve(env.UPLOAD_DIR, "backups");
const KEEP = { auto: 14, manual: 10 } as const;
/** Images are embedded while the backup stays reasonable; beyond that only their metadata is kept. */
const MAX_EMBED_BYTES = 200 * 1024 * 1024;
export const BACKUP_FORMAT = "oneknight-backup/1";

/**
 * Everything the business keeps in ONEKNIGHT, as one self-contained document. Secrets are never included:
 * no password hashes, 2FA secrets, session data or integration keys. Raw analytics events are left out
 * (they are kept for a limited time anyway).
 */
async function collect(orgId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  const team = await db
    .select({ name: users.name, email: users.email, phone: users.phone, role: memberships.role, permissions: memberships.permissions, since: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, orgId));
  const siteRows = await db.select().from(sites).where(eq(sites.organizationId, orgId));
  const categoryRows = await db.select().from(productCategories).where(eq(productCategories.organizationId, orgId));
  const productRows = await db.select().from(products).where(eq(products.organizationId, orgId)).orderBy(asc(products.createdAt));
  const orderRows = await db.select().from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.isExample, false))).orderBy(asc(orders.createdAt));
  const events = orderRows.length ? await db.select().from(orderEvents).where(inArray(orderEvents.orderId, orderRows.map((o) => o.id))).orderBy(asc(orderEvents.createdAt)) : [];
  const reviewRows = await db.select().from(reviews).where(eq(reviews.organizationId, orgId)).orderBy(asc(reviews.createdAt));
  const ticketRows = await db.select().from(tickets).where(eq(tickets.organizationId, orgId)).orderBy(asc(tickets.createdAt));
  const messages = ticketRows.length ? await db.select().from(ticketMessages).where(inArray(ticketMessages.ticketId, ticketRows.map((t) => t.id))).orderBy(asc(ticketMessages.createdAt)) : [];
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId));
  const mods = await db.select().from(moduleInstalls).where(eq(moduleInstalls.organizationId, orgId));
  const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.organizationId, orgId)).orderBy(asc(ledgerEntries.createdAt));
  const integ = await db.select({ provider: integrations.provider, status: integrations.status, settings: integrations.settings, connectedAt: integrations.connectedAt }).from(integrations).where(eq(integrations.organizationId, orgId));
  const fileRows = await db.select().from(files).where(eq(files.organizationId, orgId));

  let embedded = 0;
  const fileDocs = [];
  for (const f of fileRows) {
    let data: string | null = null;
    if (embedded + f.size <= MAX_EMBED_BYTES) {
      data = await readStored(f.storageKey).then((b) => b.toString("base64"), () => null);
      if (data) embedded += f.size;
    }
    fileDocs.push({ id: f.id, mime: f.mime, size: f.size, isPublic: f.isPublic, createdAt: f.createdAt, data });
  }
  const strip = <T extends { ip?: unknown }>(r: T) => {
    const { ip: _ip, ...rest } = r;
    return rest;
  };
  return {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    organization: org,
    team,
    sites: siteRows,
    categories: categoryRows,
    products: productRows,
    orders: orderRows.map(strip),
    orderEvents: events,
    reviews: reviewRows.map(strip),
    support: { tickets: ticketRows, messages },
    billing: { subscription: sub ?? null, modules: mods, ledger },
    integrations: integ,
    files: fileDocs,
  };
}

export async function createBackup(orgId: string, kind: "auto" | "manual", userId: string | null = null) {
  const doc = await collect(orgId);
  const buf = await gz(Buffer.from(JSON.stringify(doc)));
  const storageKey = `${randomBytes(16).toString("hex")}.json.gz`;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storageKey), buf, { flag: "wx" });
  const counts = { sites: doc.sites.length, products: doc.products.length, orders: doc.orders.length, reviews: doc.reviews.length, tickets: doc.support.tickets.length, files: doc.files.length };
  const [row] = await db.insert(backups).values({ organizationId: orgId, kind, size: buf.length, counts, storageKey, createdBy: userId }).returning();
  await prune(orgId, kind);
  return row!;
}

/** Keeps the newest N backups of each kind. */
async function prune(orgId: string, kind: "auto" | "manual") {
  const keep = await db.select({ id: backups.id }).from(backups).where(and(eq(backups.organizationId, orgId), eq(backups.kind, kind))).orderBy(desc(backups.createdAt)).limit(KEEP[kind]);
  const old = await db
    .delete(backups)
    .where(and(eq(backups.organizationId, orgId), eq(backups.kind, kind), notInArray(backups.id, keep.map((k) => k.id))))
    .returning({ storageKey: backups.storageKey });
  for (const o of old) await rm(path.join(dir, o.storageKey), { force: true });
}

export async function readBackup(storageKey: string) {
  if (!/^[0-9a-f]{32}\.json\.gz$/.test(storageKey)) throw new Error("bad key");
  return readFile(path.join(dir, storageKey));
}

/**
 * One automatic backup a day for every business with a working subscription. Runs hourly and skips
 * businesses backed up in the last 23 hours, so restarts never skip or double a day.
 */
export async function runBackups(log: { warn: (o: object, m: string) => void }, now = new Date()) {
  const orgs = await db.select({ id: subscriptions.organizationId }).from(subscriptions).where(inArray(subscriptions.status, ["trial", "active", "grace"]));
  const recent = new Set(
    (await db.select({ org: backups.organizationId }).from(backups).where(and(eq(backups.kind, "auto"), gt(backups.createdAt, new Date(now.getTime() - 23 * 3_600_000))))).map((r) => r.org),
  );
  let n = 0;
  for (const { id } of orgs) {
    if (recent.has(id)) continue;
    await createBackup(id, "auto").then(() => n++, (e) => log.warn({ org: id, err: String(e) }, "backup failed"));
  }
  return n;
}

/** Files whose rows are gone (organization deleted by cascade) are removed. */
export async function sweepBackupFiles() {
  const names = await readdir(dir).catch(() => [] as string[]);
  if (!names.length) return 0;
  const known = new Set((await db.select({ k: backups.storageKey }).from(backups)).map((r) => r.k));
  let n = 0;
  for (const name of names) {
    if (known.has(name) || !/^[0-9a-f]{32}\.json\.gz$/.test(name)) continue;
    // Skip files still being written.
    if (Date.now() - (await stat(path.join(dir, name))).mtimeMs < 3_600_000) continue;
    await rm(path.join(dir, name), { force: true });
    n++;
  }
  return n;
}
