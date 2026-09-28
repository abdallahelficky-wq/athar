import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { guardAgainstUnsafeIntegrationTestDatabase } from "../../lib/integrationTestGuard";
import {
  createPump,
  listStationsWithPumps,
  updateNozzle,
  createFuelPrice,
  listFuelPrices,
  deleteUpcomingFuelPrice,
} from "./stationSetup.service";

/** قواعد إعداد المحطات على Postgres حقيقي: المضخة فوهتان بنوعين محددين، ترقيم لكل محطة، القراءة تتسع
 * في عدد خانات العداد، والأسعار سجلّ إضافي فقط لا يُعدَّل ولا يغيّر تقييم وردية مُرحَّلة. */
guardAgainstUnsafeIntegrationTestDatabase();

const noScope = () => undefined;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe("station setup (integration)", () => {
  let tenantId: string;
  let companyId: string;
  let stationA: string;
  let stationB: string;

  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Station Setup Tenant", unlockPin: "hashed" } })).id;
    companyId = (await prisma.company.create({ data: { tenantId, name: "Fuel Co", businessActivity: "fuel_stations" } })).id;
    stationA = (await prisma.costCenter.create({ data: { tenantId, companyId, name: "محطة أ" } })).id;
    stationB = (await prisma.costCenter.create({ data: { tenantId, companyId, name: "محطة ب" } })).id;
  });

  afterAll(async () => {
    await prisma.stationShift.deleteMany({ where: { tenantId } });
    await prisma.stationNozzle.deleteMany({ where: { tenantId } });
    await prisma.fuelPrice.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  const nozzles = (d1 = 6, r1 = 1000, d2 = 6, r2 = 2000) =>
    [{ meterDigits: d1, initialReading: r1 }, { meterDigits: d2, initialReading: r2 }] as [
      { meterDigits: number; initialReading: number },
      { meterDigits: number; initialReading: number },
    ];

  it("creates a petrol pump as exactly one 91 and one 95 nozzle, and a diesel pump as two diesel nozzles, numbered per station", async () => {
    expect(await createPump(tenantId, { companyId, costCenterId: stationA, pumpType: "petrol", meterType: "mechanical", hasMoneyMeter: false, nozzles: nozzles() })).toEqual({ pumpNumber: 1 });
    expect(await createPump(tenantId, { companyId, costCenterId: stationA, pumpType: "diesel", meterType: "electronic", hasMoneyMeter: false, nozzles: nozzles(8, 12345678, 8, 5) })).toEqual({ pumpNumber: 2 });
    expect(await createPump(tenantId, { companyId, costCenterId: stationB, pumpType: "diesel", meterType: "mechanical", hasMoneyMeter: false, nozzles: nozzles() })).toEqual({ pumpNumber: 1 });

    const [a] = await listStationsWithPumps(tenantId, companyId);
    expect(a.pumps.map((p) => [p.pumpNumber, p.pumpType, p.nozzles.map((n) => n.product)])).toEqual([
      [1, "petrol", ["gasoline_91", "gasoline_95"]],
      [2, "diesel", ["diesel", "diesel"]],
    ]);
    expect(a.pumps[1].nozzles[0]).toMatchObject({ meterDigits: 8, hasReadings: false });
    expect(String(a.pumps[1].nozzles[0].initialReading)).toBe("12345678");
  });

  it("refuses a current reading that does not fit the nozzle's digit count", async () => {
    await expect(
      createPump(tenantId, { companyId, costCenterId: stationA, pumpType: "petrol", meterType: "mechanical", hasMoneyMeter: false, nozzles: nozzles(6, 1234567, 6, 1) }),
    ).rejects.toThrow(/لا تتسع في عداد من 6 خانات/);
  });

  it("refuses to lower a nozzle's digit count below a reading already recorded on it", async () => {
    const nozzle = await prisma.stationNozzle.findFirstOrThrow({ where: { tenantId, costCenterId: stationA, pumpNumber: 2, nozzleNumber: 1 } });
    await expect(updateNozzle(tenantId, noScope, nozzle.id, { meterDigits: 7 })).rejects.toThrow(/لا يتسع عداد من 7 خانات/);
    await expect(updateNozzle(tenantId, noScope, nozzle.id, { meterDigits: 9 })).resolves.toMatchObject({ meterDigits: 9 });
  });

  it("keeps prices append-only: one per product per date, current vs upcoming marked, only an upcoming one deletable", async () => {
    await createFuelPrice(tenantId, { companyId, product: "gasoline_91", priceInclVat: 2.18, effectiveFrom: isoDay(-40) });
    await createFuelPrice(tenantId, { companyId, product: "gasoline_91", priceInclVat: 2.33, effectiveFrom: isoDay(-5) });
    const upcoming = await createFuelPrice(tenantId, { companyId, product: "gasoline_91", priceInclVat: 2.4, effectiveFrom: isoDay(20) });

    await expect(createFuelPrice(tenantId, { companyId, product: "gasoline_91", priceInclVat: 9, effectiveFrom: isoDay(-5) })).rejects.toThrow(/لا تُعدَّل/);

    const list = await listFuelPrices(tenantId, companyId);
    expect(list.filter((p) => p.product === "gasoline_91").map((p) => [Number(p.priceInclVat), p.status])).toEqual([
      [2.4, "upcoming"],
      [2.33, "current"],
      [2.18, "past"],
    ]);

    const current = list.find((p) => p.status === "current")!;
    await expect(deleteUpcomingFuelPrice(tenantId, noScope, current.id)).rejects.toThrow(/لا يُحذف سعر سرى/);
    await deleteUpcomingFuelPrice(tenantId, noScope, upcoming.id);
    expect((await listFuelPrices(tenantId, companyId)).some((p) => p.id === upcoming.id)).toBe(false);
  });

  it("refuses a price dated on or before a posted shift, which would re-value it", async () => {
    const employee = await prisma.employee.create({ data: { tenantId, companyId, name: "عامل", hireDate: new Date(), basicSalary: 3000 } });
    await prisma.stationShift.create({
      data: { tenantId, companyId, costCenterId: stationA, employeeId: employee.id, shiftDate: new Date(`${isoDay(-3)}T00:00:00Z`), shiftType: "morning", status: "posted" },
    });
    await expect(createFuelPrice(tenantId, { companyId, product: "diesel", priceInclVat: 1.66, effectiveFrom: isoDay(-3) })).rejects.toThrow(/وردية مُرحَّلة/);
    await expect(createFuelPrice(tenantId, { companyId, product: "diesel", priceInclVat: 1.66, effectiveFrom: isoDay(-2) })).resolves.toBeTruthy();
    await prisma.stationShift.deleteMany({ where: { tenantId } });
    await prisma.employee.delete({ where: { id: employee.id } });
  });
});
