import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";

/**
 * scripts/migrate-deploy.cjs (سكربت start) على قاعدة مُرحَّلة بالكامل كما في CI: قفل Prisma ممسوك في جلسة أخرى — كما
 * حدث في الإنتاج 2026-10-01 — لا يمنع الإقلاع، لأن السكربت لا يطلب القفل أصلاً حين لا ترحيل معلّق.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const ROOT = path.resolve(__dirname, "../..");
const PRISMA_MIGRATE_LOCK = 72707369;

describe("migrate-deploy start script", () => {
  it("starts without waiting on a held migration lock when nothing is pending", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_lock(${PRISMA_MIGRATE_LOCK})`);
      try {
        const started = Date.now();
        const run = spawnSync(process.execPath, [path.join(ROOT, "scripts/migrate-deploy.cjs")], {
          cwd: ROOT, env: { ...process.env, DIRECT_URL: "" }, encoding: "utf8", timeout: 60_000,
        });
        expect(run.status, run.stderr).toBe(0);
        expect(run.stdout).toContain("skipping migrate deploy");
        // P1002 ينتظر القفل 10 ثوانٍ؛ التخطّي لا ينتظره
        expect(Date.now() - started).toBeLessThan(10_000);
      } finally {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_unlock(${PRISMA_MIGRATE_LOCK})`);
      }
    }, { timeout: 70_000 });
  }, 90_000);
});
