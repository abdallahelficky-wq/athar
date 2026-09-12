import { describe, it, expect } from "vitest";
import {
  computeShiftClosing,
  type ShiftClosingAccounts,
  type ShiftClosingInput,
  type NozzleReadingInput,
  type FuelPriceInput,
} from "./stationShifts.service";

const accounts: ShiftClosingAccounts = {
  cashAccountId: "acc-cash",
  revenueAccountId: "acc-revenue",
  outputVatAccountId: "acc-vat",
  networkReceivableAccountId: "acc-network",
  fuelCardReceivableAccountId: "acc-fuelcard",
  cashShortageAccountId: "acc-shortage",
  cashSurplusAccountId: "acc-surplus",
};

const SHIFT_DATE = new Date("2026-07-01T00:00:00.000Z");

function reading(overrides: Partial<NozzleReadingInput> = {}): NozzleReadingInput {
  return {
    nozzleId: "nozzle-1",
    product: "diesel",
    meterDigits: 6,
    openingReading: 0,
    closingReading: 500,
    testLiters: 0,
    ...overrides,
  };
}

function price(overrides: Partial<FuelPriceInput> = {}): FuelPriceInput {
  return { product: "diesel", priceInclVat: "1.15", effectiveFrom: new Date("2026-01-01"), ...overrides };
}

function baseInput(overrides: Partial<ShiftClosingInput> = {}): ShiftClosingInput {
  return {
    costCenterId: "station-1",
    shiftDate: SHIFT_DATE,
    readings: [reading()],
    prices: [price()],
    networkAmount: 0,
    fuelCardAmount: 0,
    cashDelivered: 0,
    creditSales: [],
    expenses: [],
    accounts,
    ...overrides,
  };
}

describe("computeShiftClosing", () => {
  it("computes a normal shift with a single nozzle, no rollover, no test liters", () => {
    const result = computeShiftClosing(baseInput({ cashDelivered: 575 }));

    expect(result.litersByNozzle).toHaveLength(1);
    expect(result.litersByNozzle[0].liters.toNumber()).toBe(500);
    expect(result.grossSales.toNumber()).toBe(575);
    expect(result.revenueExclVat.toNumber()).toBe(500);
    expect(result.outputVat.toNumber()).toBe(75);
    expect(result.expectedCash.toNumber()).toBe(575);
    expect(result.cashDue.toNumber()).toBe(575);
    expect(result.variance.toNumber()).toBe(0);

    // متوازن: إيراد + ضريبة (دائن) = نقد مُسلَّم (مدين) — بلا سطر عجز/زيادة لأن الفرق صفر
    expect(result.lines).toHaveLength(3);
    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(575);
    expect(totalCredit).toBe(575);
    expect(result.lines.find((l) => l.accountId === "acc-cash")?.debit).toBe(575);
    expect(result.lines.find((l) => l.accountId === "acc-revenue")?.credit).toBe(500);
    expect(result.lines.find((l) => l.accountId === "acc-vat")?.credit).toBe(75);
  });

  it("handles a meter rollover on a 6-digit meter (closing wraps past 999999 back to near zero)", () => {
    const result = computeShiftClosing(
      baseInput({
        readings: [reading({ meterDigits: 6, openingReading: 999900, closingReading: 100, testLiters: 0 })],
        cashDelivered: 230,
      }),
    );

    // 100 + 10^6 - 999900 = 200
    expect(result.litersByNozzle[0].liters.toNumber()).toBe(200);
    expect(result.grossSales.toNumber()).toBe(230);
    expect(result.revenueExclVat.toNumber()).toBe(200);
    expect(result.outputVat.toNumber()).toBe(30);
    expect(result.variance.toNumber()).toBe(0);
  });

  it("deducts test liters from the raw meter difference (no rollover involved)", () => {
    const result = computeShiftClosing(
      baseInput({
        readings: [reading({ openingReading: 1000, closingReading: 1600, testLiters: 100 })],
        cashDelivered: 575,
      }),
    );

    // (1600 - 1000) - 100 = 500, same volume as the normal-shift test but reached via test liters
    expect(result.litersByNozzle[0].liters.toNumber()).toBe(500);
    expect(result.grossSales.toNumber()).toBe(575);
    expect(result.variance.toNumber()).toBe(0);
  });

  it("posts a credit sale as a separate debit line tagged with the customer, and folds it into expected cash", () => {
    const result = computeShiftClosing(
      baseInput({
        creditSales: [{ customerId: "cust-1", accountId: "acc-cust1", amount: 100 }],
        cashDelivered: 475,
      }),
    );

    expect(result.creditSalesTotal.toNumber()).toBe(100);
    // 575 gross - 100 credit sales = 475 expected cash; expenses=0 so cashDue is the same
    expect(result.expectedCash.toNumber()).toBe(475);
    expect(result.cashDue.toNumber()).toBe(475);
    expect(result.variance.toNumber()).toBe(0);

    const creditLine = result.lines.find((l) => l.accountId === "acc-cust1");
    expect(creditLine).toMatchObject({ debit: 100, credit: 0, customerId: "cust-1" });
    expect(result.lines).toHaveLength(4);
    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("records a cash shortage when the cash delivered is less than the cash due", () => {
    const result = computeShiftClosing(baseInput({ cashDelivered: 500 }));

    // cashDue is 575 (no other channels); only 500 delivered -> shortage of 75
    expect(result.cashDue.toNumber()).toBe(575);
    expect(result.variance.toNumber()).toBe(-75);
    const shortageLine = result.lines.find((l) => l.accountId === "acc-shortage");
    expect(shortageLine).toMatchObject({ debit: 75, credit: 0 });
    expect(result.lines.find((l) => l.accountId === "acc-surplus")).toBeUndefined();

    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("records a cash surplus when the cash delivered exceeds the cash due", () => {
    const result = computeShiftClosing(baseInput({ cashDelivered: 600 }));

    expect(result.cashDue.toNumber()).toBe(575);
    expect(result.variance.toNumber()).toBe(25);
    const surplusLine = result.lines.find((l) => l.accountId === "acc-surplus");
    expect(surplusLine).toMatchObject({ debit: 0, credit: 25 });
    expect(result.lines.find((l) => l.accountId === "acc-shortage")).toBeUndefined();

    const totalDebit = result.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = result.lines.reduce((s, l) => s + l.credit, 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("returns a trivially balanced, empty entry when closing equals opening (zero sales)", () => {
    const result = computeShiftClosing(
      baseInput({
        readings: [reading({ openingReading: 500, closingReading: 500, testLiters: 0 })],
        cashDelivered: 0,
      }),
    );

    expect(result.litersByNozzle[0].liters.toNumber()).toBe(0);
    expect(result.grossSales.toNumber()).toBe(0);
    expect(result.revenueExclVat.toNumber()).toBe(0);
    expect(result.outputVat.toNumber()).toBe(0);
    expect(result.variance.toNumber()).toBe(0);
    expect(result.lines).toHaveLength(0);
    // liters=0 means no price lookup was needed for the product
    expect(result.salesByProduct[0].priceInclVat).toBeNull();
  });

  it("picks the fuel price effective on the shift date when multiple prices exist over time", () => {
    const result = computeShiftClosing(
      baseInput({
        prices: [
          price({ effectiveFrom: new Date("2026-01-01"), priceInclVat: "1.00" }),
          price({ effectiveFrom: new Date("2026-06-01"), priceInclVat: "1.15" }),
          // سعر مستقبلي بعد تاريخ الوردية — يجب تجاهله
          price({ effectiveFrom: new Date("2026-08-01"), priceInclVat: "5.00" }),
        ],
        cashDelivered: 575,
      }),
    );

    // لو استُخدم السعر القديم (1.00) لكانت النتيجة 500 لا 575؛ ولو استُخدم المستقبلي (5.00) لكانت 2500
    expect(result.grossSales.toNumber()).toBe(575);
    expect(result.salesByProduct[0].priceInclVat?.toNumber()).toBe(1.15);
  });

  it("rejects a nozzle whose closing reading is still below opening after rollover handling", () => {
    const input = baseInput({
      readings: [reading({ meterDigits: 6, openingReading: 999999, closingReading: 5, testLiters: 1000 })],
    });

    // 5 + 10^6 - 999999 = 6, minus 1000 test liters = -994: still negative, must be rejected
    expect(() => computeShiftClosing(input)).toThrow(/قراءة العداد غير صحيحة/);
  });
});
