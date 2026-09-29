import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/routes.ts";
import { audit } from "../audit.ts";
import { KINDS, botName, createLinkToken, setKinds, telegramStatus, unlink, type TgCall, tgCall } from "./bot.ts";

/** /api/telegram: the signed-in person's own Telegram notifications. */
export function telegramRoutes(call: TgCall = tgCall): FastifyPluginAsync {
  return async (app) => {
    app.addHook("preHandler", requireAuth);

    app.get("/", async (req) => {
      const bot = await botName(call);
      return { available: !!bot, bot, ...(await telegramStatus(req.auth!.user.id)) };
    });

    app.post("/link", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const bot = await botName(call);
      if (!bot) return reply.code(409).send({ error: "bot_not_configured" });
      const token = await createLinkToken(req.auth!.user.id);
      return { url: `https://t.me/${bot}?start=${token}` };
    });

    app.patch("/", async (req, reply) => {
      const p = z.object({ kinds: z.array(z.enum(KINDS)).max(KINDS.length) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "invalid_input" });
      await setKinds(req.auth!.user.id, [...new Set(p.data.kinds)]);
      return telegramStatus(req.auth!.user.id);
    });

    app.delete("/", async (req) => {
      await unlink(req.auth!.user.id);
      await audit(req, "telegram.unlink", req.auth!.user.id);
      return { ok: true };
    });
  };
}
