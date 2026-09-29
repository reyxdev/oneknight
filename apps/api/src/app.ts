import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { healthRoutes } from "./routes/health.ts";
import { authRoutes } from "./auth/routes.ts";
import { leadRoutes } from "./leads/routes.ts";
import { adminRoutes } from "./admin/routes.ts";
import { siteRoutes } from "./sites/routes.ts";
import { registerGuard } from "./security/guard.ts";

/** Builds the app without listening, so tests can use app.inject(). All routes live under /api. */
export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({
    trustProxy: true,
    logger: { level: "info", redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"] },
    ...opts,
  });
  registerGuard(app);
  await app.register(cookie);
  // Coarse per-IP limit for everything; auth routes set stricter limits per route.
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    // Never leak internals to users.
    reply.code(status).send({ error: status === 429 ? "too_many_requests" : status >= 500 ? "server_error" : "bad_request" });
  });
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(leadRoutes, { prefix: "/api/leads" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(siteRoutes, { prefix: "/api" });
  return app;
}
