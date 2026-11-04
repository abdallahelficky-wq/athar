import { describe, it, expect } from "vitest";
import { annualLeaveBalance, earnedLeave, latestContractAnniversary } from "./annualLeaveCalculation";
import { annualLeaveDraftSchema } from "./annualLeaveDraft.schemas";
const d = (s: string) => new Date(s);
describe("annual leave balances", () => {
  it("accrues a calendar contract year including leap days", () => {
    expect(earnedLeave(d("2023-07-01"), d("2023-07-01"), d("2024-07-01"), 21, 30)).toBe(21);
    expect(latestContractAnniversary(d("2024-02-29"), d("2025-03-01")).toISOString().slice(0,10)).toBe("2025-02-28");
  });
  it("switches entitlement only at the fifth anniversary", () => {
    expect(earnedLeave(d("2020-01-01"), d("2020-01-01"), d("2026-01-01"), 21, 30)).toBe(135);
  });
  it("replaces prior accrual with the opening balance and preserves its monetary valuation", () => {
    const result = annualLeaveBalance({ hireDate:d("2020-01-01"), anchorDate:d("2025-01-01"), leaveDate:d("2026-01-01"), throughDate:d("2025-01-01"), before:21, after:30, daily:100, carryDays:5, carryAmount:450 });
    expect(result).toMatchObject({ availableDays:35, availableAmount:3450, payDays:5, payAmount:450, remainingDays:30, remainingAmount:3000 });
  });
  it("settles all available balance without losing or duplicating carried days", () => {
    const result = annualLeaveBalance({ hireDate:d("2025-01-01"), anchorDate:d("2025-01-01"), leaveDate:d("2026-01-01"), throughDate:d("2026-01-01"), before:21, after:30, daily:100, carryDays:2, carryAmount:150 });
    expect(result).toMatchObject({ availableDays:23, payDays:23, payAmount:2250, remainingDays:0, remainingAmount:0 });
  });
  it("leaves the unselected period for the next leave", () => {
    const result = annualLeaveBalance({ hireDate:d("2025-01-01"), anchorDate:d("2025-01-01"), leaveDate:d("2026-01-01"), throughDate:d("2025-07-02"), before:21, after:30, daily:100, carryDays:0, carryAmount:0 });
    expect(result.payAmount + result.remainingAmount).toBe(result.availableAmount);
    expect(result.remainingDays).toBeGreaterThan(10);
  });
});
describe("annual leave draft validation", () => {
  const request = { companyId:"company", employeeId:"employee", leaveStartDate:"2026-11-15" };
  it("defaults to salary until the day before leave", () => expect(annualLeaveDraftSchema.parse(request).salaryMode).toBe("until_leave"));
  it.each([
    { leaveStartDate:"2026-02-30" }, { openingAmount:100,openingDate:"2026-01-01" },
    { openingDays:5 }, { balanceMode:"through_date" }, { otherAdditions:100 }, { leaveEndDate:"2026-11-14" },
    { ticketAmount:-1 }, { otherAdditions:Infinity },
  ])("rejects invalid request %j", extra => expect(annualLeaveDraftSchema.safeParse({...request,...extra}).success).toBe(false));
  it("retains a reason for printing",()=>expect(annualLeaveDraftSchema.parse({...request,otherAdditions:100,additionsReason:"  بدل انتقال  "}).additionsReason).toBe("بدل انتقال"));
});
