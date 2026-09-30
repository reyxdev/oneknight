import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../db/client.ts";
import { contentHolidays, contentTemplates } from "../db/schema.ts";
import { HOLIDAYS } from "./holidays.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");

/**
 * The starter templates (six months of daily ideas, owner's decision) and the holidays, added once: a template or a
 * holiday the admin changed or switched off is never overwritten.
 */
export async function ensureContentSeed() {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const list = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as (typeof contentTemplates.$inferInsert)[];
    for (let i = 0; i < list.length; i += 100)
      await db
        .insert(contentTemplates)
        .values(list.slice(i, i + 100).map((t) => ({ key: t.key, bucket: t.bucket, trigger: t.trigger, categories: t.categories ?? [], title: t.title, why: t.why, shot: t.shot, short: t.short, long: t.long, cta: t.cta, hashtags: t.hashtags ?? [], hooks: t.hooks ?? [], stories: t.stories ?? [], slides: t.slides ?? [], article: t.article ?? null, light: !!t.light })))
        .onConflictDoNothing();
  }
  await db.insert(contentHolidays).values(HOLIDAYS).onConflictDoNothing();
}
