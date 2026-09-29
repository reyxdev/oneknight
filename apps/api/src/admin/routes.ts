import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { leads } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { audit } from "../audit.ts";

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (!req.auth?.user.isAdmin) return reply.code(403).send({ error: "forbidden" });
}

const Status = z.object({ status: z.enum(["new", "in_progress", "won", "lost"]) });

/** Platform administration (Ivan). Every route requires is_admin. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAdmin);

  app.get("/leads", async () => {
    return db.select().from(leads).orderBy(desc(leads.createdAt)).limit(200);
  });

  app.patch<{ Params: { id: string } }>("/leads/:id", async (req, reply) => {
    const p = Status.safeParse(req.body);
    if (!p.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: "invalid_input" });
    const [row] = await db.update(leads).set({ status: p.data.status, updatedAt: new Date() }).where(eq(leads.id, req.params.id)).returning({ id: leads.id, status: leads.status });
    if (!row) return reply.code(404).send({ error: "not_found" });
    await audit(req, "lead.status", req.auth!.user.id, { lead: row.id, status: row.status });
    return row;
  });
};
