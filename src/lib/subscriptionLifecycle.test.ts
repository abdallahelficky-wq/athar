import { describe, expect, it } from "vitest";
import { dueReminder, graceEndsAt, readOnlyAt, readOnlyReminderDue, statusAfterReactivation, statusByDate } from "./subscriptionLifecycle";
import { buildSubscriptionReminderEmail } from "./subscriptionReminderEmail";
import { riyadhDayStartUtc } from "./riyadhDate";

/** docs/design/subscription-plans.md §5.4 و§6 و§6.1 — بتواريخ الجدول الزمني في الوثيقة (فترة تنتهي 2027-11-01) */
const END = riyadhDayStartUtc("2027-11-01");
const at = (day: string, hours = 0) => new Date(riyadhDayStartUtc(day).getTime() + hours * 3_600_000);

describe("subscription lifecycle rules", () => {
  it("moves a paid term active → grace at the end → expired 7 days later (§6.1: read-only from 2027-11-08)", () => {
    const row = { status: "active" as const, currentPeriodEnd: END };
    expect(statusByDate(row, at("2027-10-31", 23))).toBe("active");
    expect(statusByDate(row, at("2027-11-01"))).toBe("grace");
    expect(statusByDate(row, at("2027-11-07", 23))).toBe("grace");
    expect(statusByDate(row, at("2027-11-08"))).toBe("expired");
    expect(graceEndsAt(END)).toEqual(at("2027-11-08"));
    // صف grace يعود حسابه من النهاية نفسها
    expect(statusByDate({ status: "grace", currentPeriodEnd: END }, at("2027-11-08"))).toBe("expired");
  });

  it("gives a trial no grace: read-only at the trial end (D28)", () => {
    const row = { status: "trialing" as const, currentPeriodEnd: END };
    expect([statusByDate(row, at("2027-10-31", 23)), statusByDate(row, at("2027-11-01"))]).toEqual(["trialing", "expired"]);
    expect([readOnlyAt(row, at("2027-10-31", 23)), readOnlyAt(row, at("2027-11-01"))]).toEqual([false, true]);
  });

  it("is read-only only after grace for a paid term, always for expired / awaiting payment / canceled, and never for a legacy open-ended row", () => {
    const paid = { status: "active" as const, currentPeriodEnd: END };
    expect([readOnlyAt(paid, at("2027-11-05")), readOnlyAt(paid, at("2027-11-08"))]).toEqual([false, true]);
    for (const status of ["expired", "awaiting_payment", "canceled"] as const) expect(readOnlyAt({ status, currentPeriodEnd: END }, at("2027-01-01")), status).toBe(true);
    expect(readOnlyAt({ status: "active", currentPeriodEnd: null }, at("2099-01-01"))).toBe(false);
    expect(statusByDate({ status: "active", currentPeriodEnd: null }, at("2099-01-01"))).toBe("active");
  });

  it("leaves statuses that time does not change alone", () => {
    for (const status of ["awaiting_payment", "expired", "suspended", "canceled"] as const) {
      expect(statusByDate({ status, currentPeriodEnd: END }, at("2030-01-01"))).toBe(status);
    }
  });

  it("reactivates to the by-date status of the status before suspension, never to open-ended active", () => {
    expect(statusAfterReactivation("active", END, at("2027-10-01"))).toBe("active");
    expect(statusAfterReactivation("active", END, at("2027-11-03"))).toBe("grace");
    expect(statusAfterReactivation("grace", END, at("2027-12-01"))).toBe("expired");
    expect(statusAfterReactivation("trialing", END, at("2027-10-01"))).toBe("trialing");
    expect(statusAfterReactivation("trialing", END, at("2027-11-02"))).toBe("expired");
    expect(statusAfterReactivation("awaiting_payment", END, at("2027-10-01"))).toBe("awaiting_payment");
  });

  it("schedules reminders in non-overlapping windows: 14, 7, 1 days before, then grace start (§6.1)", () => {
    const row = { status: "active" as const, currentPeriodEnd: END };
    expect(dueReminder(row, at("2027-10-17", 23))).toBe(null);
    expect(dueReminder(row, at("2027-10-18"))).toBe("before_14");
    expect(dueReminder(row, at("2027-10-25"))).toBe("before_7");
    expect(dueReminder(row, at("2027-10-31"))).toBe("before_1");
    expect(dueReminder({ status: "grace", currentPeriodEnd: END }, at("2027-11-01"))).toBe("grace_started");
    expect(dueReminder({ status: "grace", currentPeriodEnd: END }, at("2027-11-08"))).toBe(null);
    // التجربة: تذكيرات قبل النهاية، بلا تذكير سماح
    expect(dueReminder({ status: "trialing", currentPeriodEnd: END }, at("2027-10-25"))).toBe("before_7");
    expect(dueReminder({ status: "trialing", currentPeriodEnd: END }, at("2027-11-01"))).toBe(null);
    // صف قديم بلا نهاية: لا تذكير
    expect(dueReminder({ status: "active", currentPeriodEnd: null }, at("2027-10-25"))).toBe(null);
  });

  it("sends the read-only reminder only within 7 days of read-only starting", () => {
    const since = at("2027-11-08");
    expect([readOnlyReminderDue(since, at("2027-11-07")), readOnlyReminderDue(since, at("2027-11-08")), readOnlyReminderDue(since, at("2027-11-15"))]).toEqual([false, true, false]);
  });

  it("builds the reminder email with KSA dates: a paid term is read-only 7 days after its end, a trial at its end", () => {
    const grace = buildSubscriptionReminderEmail("grace_started", "شركة <النخبة>", END, "ar");
    expect(grace.subject).toBe("شركة &lt;النخبة&gt;: انتهى الاشتراك — عرض فقط من 2027-11-08");
    expect(grace.bodyHtml).toContain("<b>2027-11-01</b>");
    expect(grace.bodyHtml).not.toContain("<النخبة>");
    expect(buildSubscriptionReminderEmail("before_7", "Elite", END, "en", true).subject).toBe("Elite: free trial ends in 7 days");
    expect(buildSubscriptionReminderEmail("read_only", "النخبة", END, "ar", true).bodyHtml).toContain("انتهت الفترة التجريبية");
    expect(buildSubscriptionReminderEmail("before_1", "النخبة", END, "ar", true).subject).toBe("النخبة: تنتهي الفترة التجريبية غداً");
    expect(buildSubscriptionReminderEmail("before_1", "النخبة", END, "ar").subject).toBe("النخبة: ينتهي الاشتراك غداً");
  });
});
