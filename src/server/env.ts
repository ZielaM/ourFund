import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a PostgreSQL connection string"),
  /** Lets anyone who can reach the app create an account. Off unless set to "true". */
  ALLOW_REGISTRATION: z
    .enum(["true", "false"], { error: 'ALLOW_REGISTRATION must be "true" or "false"' })
    .default("false")
    .transform((value) => value === "true"),
  /**
   * Where prices and exchange rates come from: "live" fetches them from the internet,
   * "off" never does (prices are then entered by hand), "fixture" serves made-up data for tests.
   */
  MARKET_DATA: z
    .enum(["live", "fixture", "off"], { error: 'MARKET_DATA must be "live", "fixture" or "off"' })
    .default("live"),
});

export type Env = z.infer<typeof envSchema>;

/** Validates server environment variables and reports every problem at once. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues.map((issue) => `- ${issue.message}`).join("\n");
    throw new Error(`Invalid server configuration:\n${problems}`);
  }

  return result.data;
}

let cached: Env | undefined;

/** Read lazily so that `next build` does not need runtime configuration. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
