import { afterEach, describe, expect, it } from "vitest";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";

describe("guardAgainstUnsafeIntegrationTestDatabase", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("throws when DATABASE_URL points to a Neon host", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@ep-cool-name-12345.us-east-2.aws.neon.tech/dbname";
    process.env.NODE_ENV = "test";
    expect(() => guardAgainstUnsafeIntegrationTestDatabase()).toThrow(/neon\.tech/);
  });

  it("throws when NODE_ENV is production, even with a safe-looking DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://athar:pw@localhost:5432/athar_dev";
    process.env.NODE_ENV = "production";
    expect(() => guardAgainstUnsafeIntegrationTestDatabase()).toThrow(/NODE_ENV=production/);
  });

  it("throws when both conditions hold", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@ep-cool-name-12345.neon.tech/dbname";
    process.env.NODE_ENV = "production";
    expect(() => guardAgainstUnsafeIntegrationTestDatabase()).toThrow();
  });

  it("does not throw for a local development database in a non-production environment", () => {
    process.env.DATABASE_URL = "postgresql://athar:pw@localhost:5432/athar_dev";
    process.env.NODE_ENV = "test";
    expect(() => guardAgainstUnsafeIntegrationTestDatabase()).not.toThrow();
  });

  it("does not throw when DATABASE_URL is unset (falls back to an empty string check)", () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = "test";
    expect(() => guardAgainstUnsafeIntegrationTestDatabase()).not.toThrow();
  });
});
