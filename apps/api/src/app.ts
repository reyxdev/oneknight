import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { healthRoutes } from "./routes/health.ts";
import { authRoutes } from "./auth/routes.ts";
import { leadRoutes } from "./leads/routes.ts";
import { adminRoutes } from "./admin/routes.ts";
import { siteRoutes } from "./sites/routes.ts";
import { billingRoutes } from "./billing/routes.ts";
import { supportRoutes } from "./support/routes.ts";
import { fileRoutes } from "./files/routes.ts";
import { shopRoutes } from "./shop/routes.ts";
import { publicRoutes } from "./public/routes.ts";
import { reviewRoutes } from "./reviews/routes.ts";
import { analyticsRoutes } from "./analytics/routes.ts";
import { dashboardRoutes } from "./dashboard/routes.ts";
import { teamRoutes } from "./team/routes.ts";
import { resetRoutes } from "./auth/reset.ts";
import { isComplete, loadAuth } from "./auth/session.ts";
import { activeMembership } from "./auth/access.ts";
import { isReadOnly } from "./billing/service.ts";
import { onboardingRoutes } from "./onboarding/routes.ts";
import { orderSettingsRoutes } from "./shop/settings.ts";
import { orderWorkRoutes } from "./shop/work.ts";
import { businessRoutes } from "./business/routes.ts";
import { customerRoutes } from "./customers/routes.ts";
import { cartRoutes } from "./carts/routes.ts";
import { productRoutes } from "./products/routes.ts";
import { projectRoutes } from "./projects/routes.ts";
import { ideaRoutes } from "./admin/comms.ts";
import { referralRoutes } from "./billing/referrals.ts";
import { announcementRoutes } from "./announcements/routes.ts";
import { backupRoutes } from "./backups/routes.ts";
import { telegramRoutes } from "./notify/routes.ts";
import type { TgCall } from "./notify/bot.ts";
import { integrationRoutes, type PrintPdf } from "./integrations/routes.ts";
import type { NpCall } from "./integrations/novaposhta.ts";
import type { PromFetch } from "./integrations/prom.ts";
import type { RozetkaFetch } from "./integrations/rozetka.ts";
import type { UpFetch } from "./integrations/ukrposhta.ts";
import { registerGuard } from "./security/guard.ts";

/** Business data that cannot be changed while the subscription is suspended (backups stay: the data can be taken away). */
const READ_ONLY_PREFIXES = ["/api/shop", "/api/customers", "/api/reviews/", "/api/integrations", "/api/business", "/api/dashboard", "/api/onboarding/examples", "/api/sites", "/api/team"];

/** Builds the app without listening, so tests can use app.inject(). All routes live under /api. */
export async function buildApp(opts: FastifyServerOptions = {}, deps: { npCall?: NpCall; promFetch?: PromFetch; rozetkaFetch?: RozetkaFetch; printPdf?: PrintPdf; upFetch?: UpFetch; tgCall?: TgCall } = {}) {
  const app = Fastify({
    trustProxy: true,
    logger: { level: "info", redact: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"] },
    ...opts,
  });
  registerGuard(app);
  await app.register(cookie);
  // Coarse per-IP limit for everything; auth routes set stricter limits per route.
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  // An admin looking at a client's panel changes nothing there (only stopping the view and signing out).
  app.addHook("preHandler", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    if (!req.cookies?.ok_session || req.url.startsWith("/api/admin/view") || req.url.startsWith("/api/auth/logout") || req.url.startsWith("/api/public")) return;
    const auth = req.auth ?? (await loadAuth(req));
    if (auth?.viewOrgId) return reply.code(403).send({ error: "view_only" });
  });
  // «Лише перегляд»: changes to a suspended business are refused (billing, support and the account stay open).
  app.addHook("preHandler", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    if (!READ_ONLY_PREFIXES.some((p) => req.url.startsWith(p))) return;
    const auth = req.auth ?? (await loadAuth(req));
    if (!auth || !isComplete(auth)) return;
    req.auth = auth;
    const m = await activeMembership(req);
    if (m && (await isReadOnly(m.orgId))) return reply.code(402).send({ error: "read_only" });
  });
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    // Never leak internals to users.
    reply.code(status).send({ error: status === 429 ? "too_many_requests" : status >= 500 ? "server_error" : "bad_request" });
  });
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(resetRoutes(deps.tgCall), { prefix: "/api/auth/reset" });
  await app.register(leadRoutes, { prefix: "/api/leads" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(siteRoutes, { prefix: "/api" });
  await app.register(billingRoutes, { prefix: "/api/billing" });
  await app.register(supportRoutes, { prefix: "/api/tickets" });
  await app.register(fileRoutes, { prefix: "/api/files" });
  await app.register(shopRoutes, { prefix: "/api/shop" });
  await app.register(orderSettingsRoutes, { prefix: "/api/shop/settings" });
  await app.register(orderWorkRoutes, { prefix: "/api/shop" });
  await app.register(cartRoutes, { prefix: "/api/shop" });
  await app.register(productRoutes, { prefix: "/api/shop" });
  await app.register(projectRoutes, { prefix: "/api/projects" });
  await app.register(ideaRoutes, { prefix: "/api/ideas" });
  await app.register(businessRoutes, { prefix: "/api/business" });
  await app.register(customerRoutes, { prefix: "/api/customers" });
  await app.register(referralRoutes, { prefix: "/api/referrals" });
  await app.register(announcementRoutes, { prefix: "/api/announcements" });
  await app.register(publicRoutes, { prefix: "/api/public" });
  await app.register(reviewRoutes, { prefix: "/api/reviews" });
  await app.register(analyticsRoutes, { prefix: "/api/analytics" });
  await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  await app.register(teamRoutes, { prefix: "/api/team" });
  await app.register(onboardingRoutes, { prefix: "/api/onboarding" });
  await app.register(backupRoutes, { prefix: "/api/backups" });
  await app.register(telegramRoutes(deps.tgCall), { prefix: "/api/telegram" });
  await app.register(integrationRoutes(deps.npCall, deps.promFetch, deps.rozetkaFetch, deps.printPdf, deps.upFetch), { prefix: "/api/integrations" });
  return app;
}
