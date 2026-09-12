import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    costCenter: { findUnique: vi.fn() },
    stationNozzle: { findMany: vi.fn(), findFirst: vi.fn() },
    fuelPrice: { findMany: vi.fn() },
    stationShift: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    stationShiftReading: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    stationShiftCollection: { upsert: vi.fn() },
    stationShiftCreditSale: { create: vi.fn() },
    stationShiftExpense: { create: vi.fn() },
    stationShiftAuditLog: { create: vi.fn(), findMany: vi.fn() },
    customer: { findFirst: vi.fn(), findUnique: vi.fn() },
    attachment: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/wellKnownAccounts", () => ({ getAccountIdByName: vi.fn(() => Promise.resolve("acc-generic")) }));
vi.mock("../../lib/journalPosting", () => ({ createJournalEntryTx: vi.fn(() => Promise.resolve({ id: "je-1" })) }));

import { prisma } from "../../lib/prisma";
import { getAccountIdByName } from "../../lib/wellKnownAccounts";
import { createJournalEntryTx } from "../../lib/journalPosting";
import * as service from "./stationShifts.service";

const TENANT = "tenant-1";
const USER = "user-1";
const SHIFT_ID = "shift-1";

function baseShift(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SHIFT_ID,
    tenantId: TENANT,
    companyId: "company-1",
    costCenterId: "station-1",
    employeeUserId: USER,
    shiftDate: new Date("2026-07-01"),
    shiftType: "morning",
    status: "open",
    journalEntryId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(((cb: (tx: unknown) => unknown) => cb(prisma)) as typeof prisma.$transaction);
  vi.mocked(getAccountIdByName).mockResolvedValue("acc-generic");
  vi.mocked(createJournalEntryTx).mockResolvedValue({ id: "je-1" } as never);
});
afterEach(() => vi.clearAllMocks());

describe("worker actions are blocked once a shift leaves 'open'", () => {
  it.each(["submitted", "under_review", "approved", "posted", "rejected"])("rejects updateCollections when status is %s", async (status) => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue(baseShift({ status }) as never);
    await expect(
      service.updateCollections(TENANT, USER, SHIFT_ID, { networkAmount: 0, fuelCardAmount: 0, cashDelivered: 100 }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.stationShiftCollection.upsert).not.toHaveBeenCalled();
  });

  it("rejects a worker acting on a shift owned by someone else", async () => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue(baseShift({ employeeUserId: "other-user" }) as never);
    await expect(service.submitShift(TENANT, USER, SHIFT_ID)).rejects.toMatchObject({ status: 403 });
  });
});

describe("opening readings are always derived server-side", () => {
  it("takes the opening reading from the previous shift's closing reading, ignoring anything the request could supply", async () => {
    vi.mocked(prisma.stationShift.findFirst)
      .mockResolvedValueOnce(baseShift() as never) // getOwnedOpenShift
      .mockResolvedValueOnce({ id: "previous-shift", readings: [{ nozzleId: "nozzle-1", closingReading: 500, accountantConfirmedValue: null }] } as never); // getPreviousClosingReadings
    vi.mocked(prisma.stationNozzle.findFirst).mockResolvedValue({ id: "nozzle-1", meterDigits: 6, product: "diesel" } as never);
    vi.mocked(prisma.stationShiftReading.upsert).mockResolvedValue({ id: "reading-1" } as never);

    await service.submitReading(TENANT, USER, SHIFT_ID, {
      nozzleId: "nozzle-1",
      closingReading: 700,
      testLiters: 0,
      workerConfirmedValue: 700,
      capturedAt: new Date(),
    });

    const call = vi.mocked(prisma.stationShiftReading.upsert).mock.calls[0][0] as { create: { openingReading: unknown } };
    expect(String(call.create.openingReading)).toBe("500");
  });

  it("defaults the opening reading to zero for a nozzle with no prior shift", async () => {
    vi.mocked(prisma.stationShift.findFirst)
      .mockResolvedValueOnce(baseShift() as never)
      .mockResolvedValueOnce(null as never); // no previous shift at all
    vi.mocked(prisma.stationNozzle.findFirst).mockResolvedValue({ id: "nozzle-1", meterDigits: 6, product: "diesel" } as never);
    vi.mocked(prisma.stationShiftReading.upsert).mockResolvedValue({ id: "reading-1" } as never);

    await service.submitReading(TENANT, USER, SHIFT_ID, {
      nozzleId: "nozzle-1",
      closingReading: 100,
      testLiters: 0,
      workerConfirmedValue: 100,
      capturedAt: new Date(),
    });

    const call = vi.mocked(prisma.stationShiftReading.upsert).mock.calls[0][0] as { create: { openingReading: unknown } };
    expect(String(call.create.openingReading)).toBe("0");
  });

  it("rejects a reading that is still negative after rollover handling, before writing anything", async () => {
    vi.mocked(prisma.stationShift.findFirst)
      .mockResolvedValueOnce(baseShift() as never)
      .mockResolvedValueOnce({ id: "previous-shift", readings: [{ nozzleId: "nozzle-1", closingReading: 999999, accountantConfirmedValue: null }] } as never);
    vi.mocked(prisma.stationNozzle.findFirst).mockResolvedValue({ id: "nozzle-1", meterDigits: 6, product: "diesel" } as never);

    await expect(
      service.submitReading(TENANT, USER, SHIFT_ID, {
        nozzleId: "nozzle-1",
        closingReading: 5, // 5 + 10^6 - 999999 = 6, minus 1000 test liters = -994
        testLiters: 1000,
        workerConfirmedValue: 5,
        capturedAt: new Date(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.stationShiftReading.upsert).not.toHaveBeenCalled();
  });
});

describe("approval completeness gate", () => {
  it("blocks approval when an active nozzle has no reading at all", async () => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue(baseShift({ status: "submitted" }) as never);
    vi.mocked(prisma.stationNozzle.findMany).mockResolvedValue([{ id: "nozzle-1" }, { id: "nozzle-2" }] as never);
    vi.mocked(prisma.stationShiftReading.findMany).mockResolvedValue([{ id: "reading-1", nozzleId: "nozzle-1" }] as never);

    await expect(service.approveShift(TENANT, USER, SHIFT_ID)).rejects.toMatchObject({ status: 400 });
    expect(createJournalEntryTx).not.toHaveBeenCalled();
    expect(prisma.stationShift.update).not.toHaveBeenCalled();
  });

  it("blocks approval when a reading has no attached meter photo", async () => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue(baseShift({ status: "submitted" }) as never);
    vi.mocked(prisma.stationNozzle.findMany).mockResolvedValue([{ id: "nozzle-1" }] as never);
    vi.mocked(prisma.stationShiftReading.findMany).mockResolvedValue([{ id: "reading-1", nozzleId: "nozzle-1" }] as never);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([] as never);

    await expect(service.approveShift(TENANT, USER, SHIFT_ID)).rejects.toMatchObject({ status: 400 });
    expect(createJournalEntryTx).not.toHaveBeenCalled();
  });
});

describe("shift status transitions", () => {
  it("moves a submitted shift to under_review on its first accountant correction, and always writes an audit log row", async () => {
    vi.mocked(prisma.stationShiftReading.findFirst).mockResolvedValue({
      id: "reading-1",
      shiftId: SHIFT_ID,
      companyId: "company-1",
      accountantConfirmedValue: null,
      shift: baseShift({ status: "submitted" }),
    } as never);
    vi.mocked(prisma.stationShiftReading.update).mockResolvedValue({ id: "reading-1", accountantConfirmedValue: 650 } as never);

    await service.correctReading(TENANT, "accountant-1", SHIFT_ID, "reading-1", 650);

    expect(prisma.stationShiftAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shiftId: SHIFT_ID, userId: "accountant-1", action: "correct_reading", newValue: "650" }),
      }),
    );
    expect(prisma.stationShift.update).toHaveBeenCalledWith({ where: { id: SHIFT_ID }, data: { status: "under_review" } });
  });

  it("does not re-trigger the under_review transition on a second correction", async () => {
    vi.mocked(prisma.stationShiftReading.findFirst).mockResolvedValue({
      id: "reading-1",
      shiftId: SHIFT_ID,
      companyId: "company-1",
      accountantConfirmedValue: 650,
      shift: baseShift({ status: "under_review" }),
    } as never);
    vi.mocked(prisma.stationShiftReading.update).mockResolvedValue({ id: "reading-1", accountantConfirmedValue: 660 } as never);

    await service.correctReading(TENANT, "accountant-1", SHIFT_ID, "reading-1", 660);

    expect(prisma.stationShiftAuditLog.create).toHaveBeenCalled();
    expect(prisma.stationShift.update).not.toHaveBeenCalled();
  });

  it("rejects correcting a reading on a shift that isn't under review", async () => {
    vi.mocked(prisma.stationShiftReading.findFirst).mockResolvedValue({
      id: "reading-1",
      shiftId: SHIFT_ID,
      shift: baseShift({ status: "open" }),
    } as never);

    await expect(service.correctReading(TENANT, "accountant-1", SHIFT_ID, "reading-1", 650)).rejects.toMatchObject({ status: 400 });
    expect(prisma.stationShiftAuditLog.create).not.toHaveBeenCalled();
  });

  it("approves a complete shift, posts the journal entry, and stores journalEntryId with status posted", async () => {
    vi.mocked(prisma.stationShift.findFirst)
      .mockResolvedValueOnce(baseShift({ status: "submitted" }) as never) // approveShift's own lookup
      .mockResolvedValueOnce(baseShift({ status: "submitted", readings: [], creditSales: [], expenses: [], collection: null }) as never); // loadShiftClosingInput
    vi.mocked(prisma.stationNozzle.findMany).mockResolvedValue([{ id: "nozzle-1" }] as never);
    vi.mocked(prisma.stationShiftReading.findMany).mockResolvedValue([{ id: "reading-1", nozzleId: "nozzle-1" }] as never);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([{ entityId: "reading-1" }] as never);
    vi.mocked(prisma.fuelPrice.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.stationShift.update).mockResolvedValue({ ...baseShift({ status: "posted" }), journalEntryId: "je-1" } as never);

    const result = await service.approveShift(TENANT, "accountant-1", SHIFT_ID);

    expect(createJournalEntryTx).toHaveBeenCalled();
    expect(prisma.stationShiftAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "approve", newValue: "posted" }) }),
    );
    expect(prisma.stationShift.update).toHaveBeenCalledWith({ where: { id: SHIFT_ID }, data: { status: "posted", journalEntryId: "je-1" } });
    expect(result).toMatchObject({ journalEntryId: "je-1" });
  });

  it("rejects a shift with a reason code, writes an audit log row, and never touches the journal entry", async () => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue(baseShift({ status: "submitted" }) as never);
    vi.mocked(prisma.stationShift.update).mockResolvedValue(baseShift({ status: "rejected", rejectionReasonCode: "meter_photo_unclear" }) as never);

    await service.rejectShift(TENANT, "accountant-1", SHIFT_ID, "meter_photo_unclear", "الصورة غير واضحة");

    expect(createJournalEntryTx).not.toHaveBeenCalled();
    expect(prisma.stationShift.update).toHaveBeenCalledWith({
      where: { id: SHIFT_ID },
      data: { status: "rejected", rejectionReasonCode: "meter_photo_unclear", rejectionNote: "الصورة غير واضحة" },
    });
    expect(prisma.stationShiftAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "reject", newValue: "rejected" }) }),
    );
  });

  it.each(["open", "approved", "posted", "rejected"])("rejects approving a shift with status %s", async (status) => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue(baseShift({ status }) as never);
    await expect(service.approveShift(TENANT, "accountant-1", SHIFT_ID)).rejects.toMatchObject({ status: 400 });
  });

  it.each(["open", "approved", "posted", "rejected"])("rejects rejecting a shift with status %s", async (status) => {
    vi.mocked(prisma.stationShift.findFirst).mockResolvedValue(baseShift({ status }) as never);
    await expect(service.rejectShift(TENANT, "accountant-1", SHIFT_ID, "some_reason", undefined)).rejects.toMatchObject({ status: 400 });
  });
});
