import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { organizations } from "../db/schema.ts";
import { requireAuth } from "../auth/routes.ts";
import { activeMembership } from "../auth/access.ts";
import { audit } from "../audit.ts";
import { Upload, saveImage } from "../files/store.ts";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const Requisites = z.object({
  kind: z.enum(["fop", "tov", "person"]),
  name: z.string().trim().min(2).max(200),
  code: z.string().trim().regex(/^\d{8,10}$/).optional().or(z.literal("")).transform((v) => v || undefined),
  iban: z.string().trim().regex(/^UA\d{27}$/).optional().or(z.literal("")).transform((v) => v || undefined),
  bank: opt(200),
  address: opt(300),
  phone: opt(30),
  email: opt(254),
  vat: z.boolean(),
  vatNumber: opt(20),
  signer: opt(120),
  /** A new image, or null to remove; omitted = keep. */
  signature: Upload.nullable().optional(),
  stamp: Upload.nullable().optional(),
});

/** /api/business: the business's requisites for documents to its customers. */
export const businessRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  /** Everyone who prints order documents reads them; images are served as the business's private files. */
  app.get("/requisites", async (req, reply) => {
    const m = await activeMembership(req);
    if (!m || !(m.role === "owner" || m.permissions.includes("orders") || m.permissions.includes("shipping"))) return reply.code(403).send({ error: "forbidden" });
    const [o] = await db.select({ r: organizations.requisites }).from(organizations).where(eq(organizations.id, m.orgId));
    const r = o?.r ?? null;
    return {
      requisites: r && { ...r, signature: r.signatureFileId ? `/api/files/${r.signatureFileId}` : null, stamp: r.stampFileId ? `/api/files/${r.stampFileId}` : null },
      canEdit: m.role === "owner",
    };
  });

  app.put("/requisites", { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const m = await activeMembership(req);
    if (m?.role !== "owner") return reply.code(403).send({ error: "forbidden" });
    const p = Requisites.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid_input", fields: p.error.issues.map((i) => i.path[0]) });
    const [o] = await db.select({ r: organizations.requisites }).from(organizations).where(eq(organizations.id, m.orgId));
    const image = async (v: z.infer<typeof Upload> | null | undefined, old: string | null | undefined) => {
      if (v === undefined) return { ok: true as const, id: old ?? null };
      if (v === null) return { ok: true as const, id: null };
      const f = await saveImage(v, { organizationId: m.orgId, uploaderId: req.auth!.user.id });
      return f.ok ? { ok: true as const, id: f.file.id } : f;
    };
    const sig = await image(p.data.signature, o?.r?.signatureFileId);
    const stamp = await image(p.data.stamp, o?.r?.stampFileId);
    if (!sig.ok || !stamp.ok) return reply.code(400).send({ error: !sig.ok ? sig.error : (stamp as { error: string }).error });
    const { signature: _s, stamp: _t, ...rest } = p.data;
    await db.update(organizations).set({ requisites: { ...rest, signatureFileId: sig.id, stampFileId: stamp.id } }).where(eq(organizations.id, m.orgId));
    await audit(req, "business.requisites", req.auth!.user.id, { kind: rest.kind, vat: rest.vat }, m.orgId);
    return { ok: true };
  });
};
