import Fastify, { type FastifyServerOptions } from "fastify";
import { healthRoutes } from "./routes/health.ts";

/** Builds the app without listening, so tests can use app.inject(). All routes live under /api. */
export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({
    trustProxy: true,
    logger: { level: "info", redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"] },
    ...opts,
  });
  await app.register(healthRoutes, { prefix: "/api" });
  return app;
}
