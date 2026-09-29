import type { FastifyBaseLogger } from "fastify";
import { db } from "../db/client.ts";
import { notifications } from "../db/schema.ts";
import { notifyOwner } from "./telegram.ts";

/** Creates an in-account notification for an organization; optionally mirrors a line to the owner's Telegram. */
export async function notifyOrg(orgId: string, kind: string, key: string, params: Record<string, string | number>, telegram: string | null, log: FastifyBaseLogger | Console) {
  await db.insert(notifications).values({ organizationId: orgId, kind, key, params });
  if (telegram) void notifyOwner(telegram, { warn: (o, m) => log.warn(o, m) });
}
