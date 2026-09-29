import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { files } from "../db/schema.ts";
import { loadAuth, isComplete } from "../auth/session.ts";
import { orgIdsOf } from "../auth/access.ts";
import { readStored } from "./store.ts";

/** GET /api/files/:id. Public files for anyone; private ones for members of the owning organization and admins. */
export const fileRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: "not_found" });
    const [f] = await db.select().from(files).where(eq(files.id, req.params.id)).limit(1);
    if (!f) return reply.code(404).send({ error: "not_found" });
    if (!f.isPublic) {
      const a = await loadAuth(req);
      if (!a || !isComplete(a)) return reply.code(401).send({ error: "unauthorized" });
      const allowed = a.user.isAdmin || (f.organizationId !== null && (await orgIdsOf(a.user.id)).includes(f.organizationId));
      if (!allowed) return reply.code(404).send({ error: "not_found" });
    }
    const buf = await readStored(f.storageKey).catch(() => null);
    if (!buf) return reply.code(404).send({ error: "not_found" });
    reply.header("content-type", f.mime).header("cache-control", f.isPublic ? "public, max-age=31536000, immutable" : "private, max-age=3600").header("content-disposition", "inline");
    return reply.send(buf);
  });
};
