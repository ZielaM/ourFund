import { hash, verify } from "@node-rs/argon2";

// Argon2id (the library default) with the OWASP-recommended minimum parameters.
const HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash must read as "wrong password", not crash the sign-in.
    return false;
  }
}
