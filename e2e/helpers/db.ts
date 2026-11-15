import { Client } from "pg";
import { e2eDatabaseUrl } from "./env";

/** Returns the e2e database to the state of a freshly installed instance. */
export async function resetDatabase(): Promise<void> {
  const client = new Client({ connectionString: e2eDatabaseUrl });
  await client.connect();

  try {
    await client.query(
      'TRUNCATE TABLE "inflation_readings", "reference_rates", "bond_rates", "bond_series", "prices", "fx_rates", "transactions", "instruments", "accounts", "portfolios", "users", "sessions", "login_attempts", "app_settings" RESTART IDENTITY CASCADE',
    );
  } finally {
    await client.end();
  }
}
