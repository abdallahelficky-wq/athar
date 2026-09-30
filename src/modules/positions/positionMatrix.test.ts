import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../middleware/auth", () => ({ hasPermission: vi.fn() }));
vi.mock("../../lib/prisma", () => ({ prisma: { $transaction: vi.fn() } }));
import { prisma } from "../../lib/prisma";
import { savePositionMatrix } from "./positions.service";
import { MATRIX_MARKER, POSITION_RESOURCES } from "../../lib/positionMatrix";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tx = { position: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
  positionPermission: { deleteMany: vi.fn(), createMany: vi.fn() } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: any) => callback(tx)) as any);
  tx.position.findFirst.mockResolvedValue({ id: "p", tenantId: "t" });
  tx.position.findUniqueOrThrow.mockResolvedValue({ id: "p", name: "Accountant", createdAt: new Date(),
    permissions: [{ moduleId: MATRIX_MARKER }], actionPermissions: [], users: [] });
});
it("saves the matrix in one transaction without erasing special permissions", async () => {
  await savePositionMatrix("t", "p", [{ resourceId: "suppliers", read: true, create: false, edit: true, delete: false, approve: false }]);
  expect(prisma.$transaction).toHaveBeenCalledOnce();
  expect(tx.position.findFirst).toHaveBeenCalledWith({ where: { id: "p", tenantId: "t" } });
  expect(tx.positionPermission.deleteMany).toHaveBeenCalledWith({ where: { positionId: "p", OR: [
    { moduleId: { startsWith: "matrix:" } }, { moduleId: MATRIX_MARKER },
  ] } });
  expect(tx.positionPermission.createMany.mock.calls[0][0].data[1]).toMatchObject({ moduleId: "matrix:suppliers", canRead: true, canCreate: false, extra: { edit: true } });
});
it("does not mutate a position outside the requesting tenant", async () => {
  tx.position.findFirst.mockResolvedValue(null);
  await expect(savePositionMatrix("other", "p", [])).rejects.toMatchObject({ status: 404 });
  expect(tx.positionPermission.deleteMany).not.toHaveBeenCalled();
  expect(tx.positionPermission.createMany).not.toHaveBeenCalled();
});
it("has a server guard on every route in each migrated service, excluding the employee portal", () => {
  for (const resource of POSITION_RESOURCES) {
    if (["hrSensitiveData", "userAdministration", "companySettings"].includes(resource.id)) continue;
    const source = readFileSync(resolve("src/modules", resource.id, `${resource.id}.routes.ts`), "utf8");
    const routes = source.split(/(?=\b\w+Routes\.(?:get|post|patch|put|delete)\()/).slice(1);
    expect(routes.length, resource.id).toBeGreaterThan(0);
    for (const route of routes) {
      const prefix = route.split(/\);/)[0];
      if (prefix.includes("authenticateEmployeePortal")) continue;
      expect(prefix, `${resource.id}: ${prefix.slice(0, 100)}`).toContain("requirePositionAction(");
    }
  }
});
