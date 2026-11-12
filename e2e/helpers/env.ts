export const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgresql://ourfund:ourfund@localhost:5432/ourfund_e2e?schema=public";

export const adminStorageState = "e2e/.auth/admin.json";

export const admin = {
  username: "szef",
  password: "haslo-administratora-1",
};

export const signedOut = { cookies: [], origins: [] };
