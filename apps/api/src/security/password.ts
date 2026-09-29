import { hash, verify } from "@node-rs/argon2";

// Argon2id (library default). Parameters follow the OWASP baseline: 19 MiB, 2 iterations.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTS);

/** A real hash of a random value: verifying against it keeps timing equal for unknown emails. */
const DUMMY = hash("dummy-password-for-timing", OPTS);

export async function verifyPassword(hashed: string | null, password: string): Promise<boolean> {
  if (!hashed) {
    await verify(await DUMMY, password).catch(() => false);
    return false;
  }
  return verify(hashed, password).catch(() => false);
}
