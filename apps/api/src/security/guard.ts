import type { FastifyInstance } from "fastify";
import { env } from "../config.ts";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence on top of SameSite=Lax cookies: state-changing requests must come from an allowed
 * origin and carry a JSON body type (a cross-site HTML form cannot send application/json).
 */
export function registerGuard(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    if (!UNSAFE.has(req.method)) return;
    const origin = req.headers.origin;
    // The public site API (no cookies, site key auth) checks the origin against the site's own domain.
    const isPublic = req.url.startsWith("/api/public/");
    if (!isPublic && origin && !env.APP_ORIGINS.includes(origin)) return reply.code(403).send({ error: "bad_origin" });
    const hasBody = req.headers["content-length"] && req.headers["content-length"] !== "0";
    if (hasBody && !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
      return reply.code(415).send({ error: "json_required" });
    }
  });
}
