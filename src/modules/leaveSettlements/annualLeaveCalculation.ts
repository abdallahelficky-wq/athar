/** Pure calculation shared by the annual-leave preview and its persisted draft snapshot.
 * An opening balance REPLACES accrual before its date; it is never added to lifetime accrual.
 * Contract anniversaries use UTC calendar years (including leap-day hires).
 */
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const DAY = 86400000;
export function anniversary(hire: Date, year: number) {
  const last = new Date(Date.UTC(year, hire.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, hire.getUTCMonth(), Math.min(hire.getUTCDate(), last)));
}
export function earnedLeave(hire: Date, from: Date, to: Date, before: number, after: number) {
  let cursor = new Date(Math.max(hire.getTime(), from.getTime())), days = 0;
  while (cursor < to) {
    let year = cursor.getUTCFullYear();
    if (anniversary(hire, year) > cursor) year--;
    const start = anniversary(hire, year), end = anniversary(hire, year + 1);
    const until = new Date(Math.min(end.getTime(), to.getTime()));
    days += (until.getTime() - cursor.getTime()) / (end.getTime() - start.getTime()) * (year - hire.getUTCFullYear() < 5 ? before : after);
    cursor = until;
  }
  return days;
}
export function latestContractAnniversary(hire: Date, date: Date) {
  let result = anniversary(hire, date.getUTCFullYear());
  if (result > date) result = anniversary(hire, date.getUTCFullYear() - 1);
  return new Date(Math.max(result.getTime(), hire.getTime()));
}
export function annualLeaveBalance(input: {
  hireDate: Date; leaveDate: Date; throughDate: Date; before: number; after: number; daily: number;
  anchorDate: Date; carryDays: number; carryAmount: number;
}) {
  const { hireDate, leaveDate, throughDate, before, after, daily, anchorDate, carryDays, carryAmount } = input;
  const newDays = earnedLeave(hireDate, anchorDate, leaveDate, before, after);
  const payableNewDays = earnedLeave(hireDate, anchorDate, throughDate, before, after);
  const availableDays = carryDays + newDays, availableAmount = carryAmount + newDays * daily;
  const payDays = Math.min(availableDays, carryDays + payableNewDays);
  const payAmount = Math.min(availableAmount, carryAmount + payableNewDays * daily);
  return { carryDays: roundMoney(carryDays), carryAmount: roundMoney(carryAmount),
    earnedDays: roundMoney(newDays), availableDays: roundMoney(availableDays), availableAmount: roundMoney(availableAmount),
    payDays: roundMoney(payDays), payAmount: roundMoney(payAmount),
    remainingDays: roundMoney(availableDays - payDays), remainingAmount: roundMoney(availableAmount - payAmount),
    calendarDays: Math.max(Math.floor((leaveDate.getTime() - hireDate.getTime()) / DAY), 0) };
}
