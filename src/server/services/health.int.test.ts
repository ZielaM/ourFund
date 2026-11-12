import { afterAll, describe, expect, it } from "vitest";
import { disconnectDb, getDb } from "@/server/db/client";
import { checkHealth } from "./health";

describe("checkHealth against PostgreSQL", () => {
  afterAll(async () => {
    await disconnectDb();
  });

  it("reports ok for a reachable database", async () => {
    await expect(checkHealth(getDb())).resolves.toEqual({ status: "ok", database: "ok" });
  });

  it("reuses one client instance", () => {
    expect(getDb()).toBe(getDb());
  });

  it("has the migrated schema available", async () => {
    const db = getDb();
    const key = "test.health";

    await db.appSetting.upsert({
      where: { key },
      create: { key, value: { checked: true } },
      update: { value: { checked: true } },
    });

    await expect(db.appSetting.findUnique({ where: { key } })).resolves.toMatchObject({
      key,
      value: { checked: true },
    });

    await db.appSetting.delete({ where: { key } });
  });

  it("opens a fresh connection after disconnecting", async () => {
    const before = getDb();
    await disconnectDb();

    expect(getDb()).not.toBe(before);
    await expect(checkHealth(getDb())).resolves.toMatchObject({ status: "ok" });
  });
});
