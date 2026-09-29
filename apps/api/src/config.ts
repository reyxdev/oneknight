import { z } from "zod";

/** Environment is validated once at startup. The server refuses to start with a bad config. */
const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("127.0.0.1"),
});

export const env = Env.parse(process.env);
export const isProd = env.NODE_ENV === "production";
