import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "./prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "./integrationTestGuard";

/**
 * استعلامات تشخيص التشغيل (scripts/ops/*.sql) التي يشغّلها المالك على الإنتاج — CLAUDE.md القاعدة 3. لا تقرأ بيانات مستأجر،
 * فلا تدخل اختبار productionQueries (الذي يفحص فصل الشركات)، وتُختبَر هنا على ما تعدّه فعلاً: الترحيلات وقفل Prisma.
 */
guardAgainstUnsafeIntegrationTestDatabase();

const ROOT = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, "scripts/ops", file), "utf8");
const PRISMA_MIGRATE_LOCK = 72707369;

describe("ops diagnostic queries", () => {
  it("migration-status lists the latest applied migrations", async () => {
    const rows: { migration_name: string; finished_at: Date | null }[] = await prisma.$queryRawUnsafe(read("migration-status.sql"));
    const latest = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].migration_name).toBe(latest[0].migration_name);
    expect(rows.every((r) => r.finished_at !== null)).toBe(true);
  });

  it("migration-lock-holders shows the session holding Prisma's lock, and nothing once it is released", async () => {
    const query = read("migration-lock-holders.sql");
    // جلسة تمسك القفل كما يفعل prisma migrate deploy (اتصال واحد مثبَّت طوال المعاملة التفاعلية)
    await prisma.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRawUnsafe<{ pid: number }[]>(`SELECT pg_backend_pid() AS pid`);
      await tx.$executeRawUnsafe(`SELECT pg_advisory_lock(${PRISMA_MIGRATE_LOCK})`);
      try {
        const rows: { pid: number; granted: boolean }[] = await prisma.$queryRawUnsafe(query);
        expect(rows).toContainEqual(expect.objectContaining({ pid, granted: true }));
      } finally {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_unlock(${PRISMA_MIGRATE_LOCK})`);
      }
    });
    expect(await prisma.$queryRawUnsafe(query)).toEqual([]);
  });
});
