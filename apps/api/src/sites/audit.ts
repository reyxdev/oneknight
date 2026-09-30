import { and, desc, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { notifications, siteAudits, sites } from "../db/schema.ts";
import { publicRequest } from "../security/public-fetch.ts";

type Req = typeof publicRequest;
const DAY = 86_400_000;
const PAGE_BYTES = 3 * 1024 * 1024;
export const AUDIT_EVERY_DAYS = 7;
const MAX_LINKS = 50;

/**
 * Looks for ok.js with the site's key in the HTML of its home page (https, then www). Found → the site is confirmed:
 * monitoring starts and it counts as a website of the business (an extra one is +149 грн/міс).
 */
export async function verifySite(site: { id: string; domain: string; publicKey: string; verifiedAt: Date | null }, req: Req = publicRequest) {
  if (site.verifiedAt) return true;
  for (const host of [site.domain, `www.${site.domain}`]) {
    const page = await req(`https://${host}/`, { maxBytes: PAGE_BYTES, timeoutMs: 12_000 }).catch(() => null);
    if (page && page.status < 400 && page.body.toString("utf8").includes(site.publicKey)) {
      await db.update(sites).set({ verifiedAt: new Date() }).where(and(eq(sites.id, site.id), isNull(sites.verifiedAt)));
      return true;
    }
  }
  return false;
}

/** Unconfirmed sites younger than 14 days are looked at again every monitoring round (the client installs ok.js). */
export async function verifyPending(req: Req = publicRequest) {
  const list = await db.select().from(sites).where(and(isNull(sites.verifiedAt), gt(sites.createdAt, new Date(Date.now() - 14 * DAY))));
  let n = 0;
  for (const s of list) if (await verifySite(s, req)) n++;
  return n;
}

/** An attribute of a tag, quoted or not (`lang=en` is valid HTML). */
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : null;
};
const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const meta = (html: string, key: string) => tags(html, "meta").find((t) => (attr(t, "name") ?? attr(t, "property"))?.toLowerCase() === key);
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/**
 * The checks, all measured here from the page itself (owner's decision: no outside services). Each is ok or not,
 * with the value found; the panel explains what to do.
 */
export async function auditPage(domain: string, req: Req = publicRequest) {
  const url = `https://${domain}/`;
  const page = await req(url, { maxBytes: PAGE_BYTES, timeoutMs: 20_000 });
  const html = page.body.toString("utf8");
  const head = html.slice(0, 200_000);
  const checks: { id: string; group: string; ok: boolean; value?: string | number | null; items?: string[] }[] = [];
  const add = (group: string, id: string, ok: boolean, value?: string | number | null, items?: string[]) => checks.push({ id, group, ok, ...(value !== undefined ? { value } : {}), ...(items?.length ? { items: items.slice(0, 10) } : {}) });

  // Speed.
  add("speed", "response", page.ms <= 800, page.ms);
  add("speed", "size", page.body.length <= 500 * 1024, Math.round(page.body.length / 1024));
  add("speed", "compression", /gzip|br|zstd/i.test(page.headers.get("content-encoding") ?? ""), page.headers.get("content-encoding") ?? null);
  add("speed", "redirects", page.redirects <= 1, page.redirects);

  // Phone.
  const viewport = meta(head, "viewport");
  add("mobile", "viewport", !!viewport && /width\s*=\s*device-width/i.test(attr(viewport, "content") ?? ""), viewport ? attr(viewport, "content") : null);

  // Search engines.
  const title = text(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  add("seo", "title", title.length >= 10 && title.length <= 65, title || null);
  const description = meta(head, "description") ? attr(meta(head, "description")!, "content") ?? "" : "";
  add("seo", "description", description.length >= 50 && description.length <= 160, description || null);
  const h1 = tags(html, "h1").length;
  add("seo", "h1", h1 === 1, h1);
  add("seo", "lang", !!attr(tags(head, "html")[0] ?? "", "lang"), attr(tags(head, "html")[0] ?? "", "lang"));
  add("seo", "canonical", tags(head, "link").some((t) => attr(t, "rel")?.toLowerCase() === "canonical"));
  add("seo", "ogImage", !!meta(head, "og:image"));
  const noAlt = tags(html, "img").filter((t) => !attr(t, "alt")).map((t) => attr(t, "src") ?? "?");
  add("seo", "alt", noAlt.length === 0, noAlt.length, noAlt);
  const robots = await req(`https://${domain}/robots.txt`, { maxBytes: 200_000, timeoutMs: 8000 }).catch(() => null);
  add("seo", "robots", !!robots && robots.status === 200);
  const sitemapUrl = robots?.status === 200 ? robots.body.toString("utf8").match(/^\s*sitemap:\s*(\S+)/im)?.[1] : undefined;
  const sitemap = await req(sitemapUrl ?? `https://${domain}/sitemap.xml`, { maxBytes: 5_000_000, timeoutMs: 8000 }).catch(() => null);
  add("seo", "sitemap", !!sitemap && sitemap.status === 200);
  const http = await req(`http://${domain}/`, { maxBytes: PAGE_BYTES, method: "HEAD", timeoutMs: 8000 }).catch(() => null);
  add("seo", "https", !!http && http.url.startsWith("https://"));

  // Broken links on the home page (the site's own ones, up to 50).
  const base = new URL(page.url);
  const links = [
    ...new Set(
      tags(html, "a")
        .map((t) => attr(t, "href"))
        .filter((h): h is string => !!h && !/^(#|mailto:|tel:|javascript:|viber:|tg:)/i.test(h))
        .map((h) => {
          try {
            const u = new URL(h, base);
            u.hash = "";
            return u.hostname.replace(/^www\./, "") === domain ? u.toString() : null;
          } catch {
            return null;
          }
        })
        .filter((u): u is string => !!u),
    ),
  ].slice(0, MAX_LINKS);
  const broken: string[] = [];
  for (let i = 0; i < links.length; i += 4) {
    await Promise.all(
      links.slice(i, i + 4).map(async (l) => {
        const r = await req(l, { maxBytes: PAGE_BYTES, method: "HEAD", timeoutMs: 8000 }).catch(() => null);
        // Some servers refuse HEAD: ask again with GET before calling a link broken.
        const r2 = r && r.status < 400 ? r : await req(l, { maxBytes: PAGE_BYTES, timeoutMs: 8000 }).catch(() => null);
        if (!r2 || r2.status >= 400) broken.push(new URL(l).pathname);
      }),
    );
  }
  add("links", "broken", broken.length === 0, `${broken.length}/${links.length}`, broken);
  return checks;
}

export async function runAudit(site: { id: string; domain: string; organizationId: string }, req: Req = publicRequest) {
  const checks = await auditPage(site.domain, req);
  const passed = checks.filter((c) => c.ok).length;
  const [prev] = await db.select().from(siteAudits).where(eq(siteAudits.siteId, site.id)).orderBy(desc(siteAudits.createdAt)).limit(1);
  const [row] = await db.insert(siteAudits).values({ siteId: site.id, passed, total: checks.length, checks }).returning();
  // The bell only when something is to be fixed and it is news (first audit, or fewer checks passed than before).
  if (passed < checks.length && (!prev || passed < prev.passed)) await db.insert(notifications).values({ organizationId: site.organizationId, kind: "site", key: "auditDone", params: { domain: site.domain, passed, total: checks.length } });
  return row!;
}

/** Hourly: confirmed live sites whose last audit is a week old (a few per round). */
export async function runWeeklyAudits(log: { warn: (o: object, m: string) => void }, req: Req = publicRequest) {
  const due = await db
    .select({ id: sites.id, domain: sites.domain, organizationId: sites.organizationId, last: siteAudits.createdAt })
    .from(sites)
    .leftJoin(siteAudits, and(eq(siteAudits.siteId, sites.id), gt(siteAudits.createdAt, new Date(Date.now() - AUDIT_EVERY_DAYS * DAY))))
    .where(and(isNotNull(sites.verifiedAt), eq(sites.status, "live"), isNull(siteAudits.id)))
    .limit(5);
  for (const s of due) await runAudit(s, req).catch((e) => log.warn({ err: String(e), site: s.domain }, "audit failed"));
  await db.delete(siteAudits).where(lt(siteAudits.createdAt, new Date(Date.now() - 180 * DAY)));
  return due.length;
}
