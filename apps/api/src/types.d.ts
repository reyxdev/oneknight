import type { Auth } from "./auth/session.ts";

declare module "fastify" {
  interface FastifyRequest {
    auth?: Auth;
  }
}
