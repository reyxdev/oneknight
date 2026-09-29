import type { FastifyPluginAsync } from "fastify";
import { sql } from "../db/client.ts";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_req, reply) => {
    try {
      await sql`select 1`;
      return { ok: true, db: "up" };
    } catch {
      return reply.code(503).send({ ok: false, db: "down" });
    }
  });
};
