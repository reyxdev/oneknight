import type { FastifyPluginAsync } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { memberships, organizations, platformState, users } from "../db/schema.ts";
import { DEFAULT_CALCULATOR, DEFAULT_PORTFOLIO_PRICES, type CalculatorConfig, type PortfolioPrices } from "@oneknight/domain";
import { statusSummary } from "./status.ts";

/** The calculator's numbers: the owner's (platform_state `calculator`) or the draft. */
export async function calculatorConfig(): Promise<CalculatorConfig> {
  const [row] = await db.select().from(platformState).where(eq(platformState.key, "calculator"));
  return { ...DEFAULT_CALCULATOR, ...((row?.value ?? {}) as Partial<CalculatorConfig>) };
}

/** The portfolio's numbers the owner changes in the admin (answers 107, 243, 394, 468, 485). */
export type PortfolioSettings = { prices: PortfolioPrices; placesLeft: number; buildingNow: number };
export async function portfolioSettings(): Promise<PortfolioSettings> {
  const [row] = await db.select().from(platformState).where(eq(platformState.key, "portfolio"));
  const v = (row?.value ?? {}) as Partial<PortfolioSettings>;
  return { prices: { ...DEFAULT_PORTFOLIO_PRICES, ...v.prices }, placesLeft: v.placesLeft ?? 8, buildingNow: v.buildingNow ?? 0 };
}

/** /api/site: what the public site oneknight.pro reads (no session, no site key). */
export const landingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/status", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    return statusSummary();
  });

  app.get("/portfolio", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    return portfolioSettings();
  });

  app.get("/calculator", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return calculatorConfig();
  });

  /** «Вас запросив бізнес X»: the business of the person whose referral link was opened. */
  app.get<{ Params: { code: string } }>("/invite/:code", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const code = req.params.code.toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) return reply.code(404).send({ error: "not_found" });
    const [row] = await db
      .select({ business: organizations.name })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.role, "owner")))
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(users.refCode, code))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    return row ?? reply.code(404).send({ error: "not_found" });
  });
};
