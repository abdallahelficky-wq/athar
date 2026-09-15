import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    company: { findUnique: vi.fn() },
    costCenter: { findMany: vi.fn() },
    stationShiftReading: { findMany: vi.fn() },
    stationShiftCollection: { findMany: vi.fn() },
    stationShiftExpense: { findMany: vi.fn() },
    stationShift: { findMany: vi.fn() },
    fuelPrice: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
  },
}));
vi.mock("../../lib/wellKnownAccounts", () => ({ getAccountIdByName: vi.fn(() => Promise.resolve("acc-generic")) }));

import { prisma } from "../../lib/prisma";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { getSalesVolumeReport, getNetCashReport, type ReportRange } from "./stationShiftsReports.service";

const TENANT = "tenant-1";
const COMPANY = "company-1";
const RANGE: ReportRange = { dateFrom: new Date("2026-09-01"), dateTo: new Date("2026-09-30") };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.company.findUnique).mockResolvedValue({ stationCashShortageAccountId: "acc-shortage", stationCashSurplusAccountId: "acc-surplus" } as never);
  vi.mocked(prisma.customer.findMany).mockResolvedValue([] as never);
  vi.mocked(getAccountIdByName).mockResolvedValue("acc-generic");
});

describe("date range guard", () => {
  it("rejects a range longer than 366 days", async () => {
    vi.mocked(prisma.costCenter.findMany).mockResolvedValue([] as never);
    await expect(
      getSalesVolumeReport(TENANT, COMPANY, "station", { dateFrom: new Date("2020-01-01"), dateTo: new Date("2026-01-01") }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a range where dateFrom is after dateTo", async () => {
    vi.mocked(prisma.costCenter.findMany).mockResolvedValue([] as never);
    await expect(
      getSalesVolumeReport(TENANT, COMPANY, "station", { dateFrom: new Date("2026-09-30"), dateTo: new Date("2026-09-01") }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("station filter validation", () => {
  it("rejects a requested costCenterId that doesn't belong to the company", async () => {
    vi.mocked(prisma.costCenter.findMany).mockResolvedValue([] as never); // لا يطابق أياً من المطلوب
    await expect(getSalesVolumeReport(TENANT, COMPANY, "station", RANGE, ["not-mine"])).rejects.toMatchObject({ status: 400 });
  });
});

describe("getSalesVolumeReport", () => {
  it("computes liters and both VAT-in/excl sales values from the same price source computeShiftClosing uses", async () => {
    vi.mocked(prisma.costCenter.findMany).mockResolvedValue([{ id: "station-1", name: "Station 1" }] as never);
    vi.mocked(prisma.stationShiftReading.findMany).mockResolvedValue([
      {
        shiftId: "shift-1",
        nozzleId: "n1",
        nozzle: { pumpNumber: 1, nozzleNumber: 1, product: "diesel", meterDigits: 6 },
        shift: { status: "posted", shiftDate: new Date("2026-09-10"), costCenterId: "station-1" },
        openingReading: 0,
        closingReading: null,
        accountantConfirmedValue: 1000,
        testLiters: 0,
      },
    ] as never);
    vi.mocked(prisma.fuelPrice.findMany).mockResolvedValue([
      { product: "diesel", priceInclVat: 1.15, effectiveFrom: new Date("2020-01-01"), costCenterId: null },
    ] as never);

    const report = await getSalesVolumeReport(TENANT, COMPANY, "product", RANGE);

    expect(report.rows).toEqual([{ product: "diesel", liters: 1000, salesValueExclVat: 1000, salesValueInclVat: 1150 }]);
    expect(report.totals.combined).toEqual({ liters: 1000, salesValueExclVat: 1000, salesValueInclVat: 1150 });
    expect(report.totals.posted).toEqual({ liters: 1000, salesValueExclVat: 1000, salesValueInclVat: 1150 });
    expect(report.totals.approved).toEqual({ liters: 0, salesValueExclVat: 0, salesValueInclVat: 0 });
  });
});

describe("getNetCashReport shortage/surplus totals", () => {
  it("never nets a shortage day against a surplus day in the totals block", async () => {
    vi.mocked(prisma.costCenter.findMany).mockResolvedValue([{ id: "station-1", name: "Station 1" }] as never);
    vi.mocked(prisma.fuelPrice.findMany).mockResolvedValue([
      { product: "diesel", priceInclVat: 1.15, effectiveFrom: new Date("2020-01-01"), costCenterId: null },
    ] as never);

    const readingFor = (shiftId: string) => [
      { nozzleId: "n1", nozzle: { product: "diesel", meterDigits: 6 }, openingReading: 0, closingReading: null, accountantConfirmedValue: 1000, testLiters: 0 },
    ];
    // كلا الوردية: 1000 لتر ديزل × 1.15 = 1150 مبيعات شاملة الضريبة، بلا شبكة/بطاقة/مصروفات/بيع
    // آجل — expectedCash = cashDue = 1150 لكل وردية. الفرق الوحيد بينهما هو cashDelivered.
    vi.mocked(prisma.stationShift.findMany).mockResolvedValue([
      {
        id: "shift-shortage",
        costCenterId: "station-1",
        shiftDate: new Date("2026-09-10"),
        status: "posted",
        readings: readingFor("shift-shortage"),
        expenses: [],
        collection: { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 1050 }, // 100 أقل من 1150 → عجز
        creditSales: [],
      },
      {
        id: "shift-surplus",
        costCenterId: "station-1",
        shiftDate: new Date("2026-09-11"),
        status: "posted",
        readings: readingFor("shift-surplus"),
        expenses: [],
        collection: { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 1250 }, // 100 أكثر من 1150 → زيادة
        creditSales: [],
      },
    ] as never);

    const report = await getNetCashReport(TENANT, COMPANY, RANGE);

    // اليوميات: كل يوم يحمل عجزه أو زيادته فقط، بلا تقاصّ عبر الأيام.
    expect(report.daily).toEqual([
      expect.objectContaining({ date: "2026-09-10", shortageTotal: 100, surplusTotal: 0, netVariance: -100 }),
      expect.objectContaining({ date: "2026-09-11", shortageTotal: 0, surplusTotal: 100, netVariance: 100 }),
    ]);

    // الإجمالي: عجز 100 وزيادة 100 معاً — لا صفر مضلِّل رغم أن المجموع الجبري (netVariance) فعلاً صفر.
    expect(report.totals.combined.shortageTotal).toBe(100);
    expect(report.totals.combined.surplusTotal).toBe(100);
    expect(report.totals.combined.netVariance).toBe(0);
    expect(report.totals.combined.cashDue).toBe(2300);
    expect(report.totals.combined.cashDelivered).toBe(2300);

    // نفس المعاملة لكل محطة عند التجميع حسبها.
    expect(report.byStation).toEqual([
      expect.objectContaining({ costCenterId: "station-1", shortageTotal: 100, surplusTotal: 100, netVariance: 0 }),
    ]);
  });
});
