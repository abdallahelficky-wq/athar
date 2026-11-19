import type { Lang } from "./i18n/translate";

/**
 * بريد تنبيهات الإيجارات اليومي — بناء خالص (بلا قاعدة بيانات ولا إرسال) من ناتج leaseAlerts نفسه، فما في البريد هو ما في لوحة
 * التنبيهات بالضبط. كل نص مصدره المستخدم (عنوان العقد، المؤجر، الملاحظة) يُهرَّب قبل وضعه في HTML.
 */
export interface LeaseAlertsForEmail {
  today: string;
  dueWithinDays: number;
  renewalWithinDays: number;
  overdue: { title: string; counterparty: string | null; dueDate: string; amount: number; days: number }[];
  dueSoon: { title: string; counterparty: string | null; dueDate: string; amount: number; days: number }[];
  // تحصيلات عقود التأجير للغير (اختيارية لتوافق المستدعين الأقدم)
  collectOverdue?: { title: string; counterparty: string | null; dueDate: string; amount: number; days: number }[];
  collectSoon?: { title: string; counterparty: string | null; dueDate: string; amount: number; days: number }[];
  renewals: { title: string; endDate: string; noticeDeadline: string; daysToDeadline: number; daysToEnd: number; kind: string; autoRenew: boolean; direction?: string }[];
  totals: { overdue: number; dueSoon: number; collectOverdue?: number; collectSoon?: number };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function section(title: string, color: string, headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th style="text-align:start; padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.15); font-size:12px; color:#5c6b78;">${h}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:6px 8px; border-bottom:1px solid rgba(16,32,46,0.06); font-size:13px;">${c}</td>`).join("")}</tr>`).join("");
  return `
    <div style="margin-bottom:22px; border:1px solid rgba(16,32,46,0.12); border-radius:10px; overflow:hidden;">
      <div style="background:${color}; color:#fff; padding:9px 14px; font-weight:700; font-size:14px;">${title}</div>
      <table style="width:100%; border-collapse:collapse;"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
    </div>`;
}

export function hasLeaseAlerts(alerts: LeaseAlertsForEmail): boolean {
  return alerts.overdue.length + alerts.dueSoon.length + (alerts.collectOverdue?.length ?? 0) + (alerts.collectSoon?.length ?? 0) + alerts.renewals.length > 0;
}

export function buildLeaseReminderEmail(companyName: string, alerts: LeaseAlertsForEmail, lang: Lang, screenUrl: string): { subject: string; bodyHtml: string } {
  const en = lang === "en";
  const name = escapeHtml(companyName);
  const party = (r: { title: string; counterparty?: string | null }) => `<strong>${escapeHtml(r.title)}</strong>${r.counterparty ? `<div style="color:#5c6b78; font-size:12px;">${escapeHtml(r.counterparty)}</div>` : ""}`;
  const parts: string[] = [];

  if (alerts.overdue.length) {
    parts.push(section(
      en ? `Overdue payments (${alerts.overdue.length}) — ${money(alerts.totals.overdue)}` : `دفعات متأخرة (${alerts.overdue.length}) — ${money(alerts.totals.overdue)}`,
      "#A8432B",
      en ? ["Contract", "Due date", "Amount", "Late"] : ["العقد", "تاريخ الاستحقاق", "المبلغ", "التأخير"],
      alerts.overdue.map((p) => [party(p), p.dueDate, money(p.amount), en ? `${Math.abs(p.days)} days` : `${Math.abs(p.days)} يوماً`]),
    ));
  }
  if (alerts.dueSoon.length) {
    parts.push(section(
      en ? `Due within ${alerts.dueWithinDays} days (${alerts.dueSoon.length}) — ${money(alerts.totals.dueSoon)}` : `تستحق خلال ${alerts.dueWithinDays} يوماً (${alerts.dueSoon.length}) — ${money(alerts.totals.dueSoon)}`,
      "#B7791F",
      en ? ["Contract", "Due date", "Amount", "In"] : ["العقد", "تاريخ الاستحقاق", "المبلغ", "بعد"],
      alerts.dueSoon.map((p) => [party(p), p.dueDate, money(p.amount), p.days === 0 ? (en ? "today" : "اليوم") : en ? `${p.days} days` : `${p.days} يوماً`]),
    ));
  }
  const collectOverdue = alerts.collectOverdue ?? [];
  const collectSoon = alerts.collectSoon ?? [];
  if (collectOverdue.length) {
    parts.push(section(
      en ? `Overdue collections from tenants (${collectOverdue.length}) — ${money(alerts.totals.collectOverdue ?? 0)}` : `تحصيلات متأخرة من المستأجرين (${collectOverdue.length}) — ${money(alerts.totals.collectOverdue ?? 0)}`,
      "#6B3FA0",
      en ? ["Contract", "Due date", "Amount", "Late by"] : ["العقد", "تاريخ الاستحقاق", "المبلغ", "متأخرة"],
      collectOverdue.map((p) => [party(p), p.dueDate, money(p.amount), en ? `${Math.abs(p.days)} days` : `${Math.abs(p.days)} يوماً`]),
    ));
  }
  if (collectSoon.length) {
    parts.push(section(
      en ? `Collections due within ${alerts.dueWithinDays} days (${collectSoon.length}) — ${money(alerts.totals.collectSoon ?? 0)}` : `تحصيلات تستحق خلال ${alerts.dueWithinDays} يوماً (${collectSoon.length}) — ${money(alerts.totals.collectSoon ?? 0)}`,
      "#2B6CB0",
      en ? ["Contract", "Due date", "Amount", "In"] : ["العقد", "تاريخ الاستحقاق", "المبلغ", "بعد"],
      collectSoon.map((p) => [party(p), p.dueDate, money(p.amount), p.days === 0 ? (en ? "today" : "اليوم") : en ? `${p.days} days` : `${p.days} يوماً`]),
    ));
  }
  if (alerts.renewals.length) {
    const status = (r: LeaseAlertsForEmail["renewals"][number]) => {
      if (r.kind === "expired") return en ? `Term ended ${Math.abs(r.daysToEnd)} days ago` : `انتهت المدة منذ ${Math.abs(r.daysToEnd)} يوماً`;
      if (r.kind === "notice_passed") return en ? `Notice deadline passed ${Math.abs(r.daysToDeadline)} days ago` : `فات آخر موعد للإشعار منذ ${Math.abs(r.daysToDeadline)} يوماً`;
      return en ? `Notice deadline in ${r.daysToDeadline} days` : `آخر موعد للإشعار بعد ${r.daysToDeadline} يوماً`;
    };
    parts.push(section(
      en ? `Contracts needing a renewal decision (${alerts.renewals.length})` : `عقود تحتاج قرار تجديد (${alerts.renewals.length})`,
      "#0F4C5C",
      en ? ["Contract", "Notice deadline", "Contract end", "Status"] : ["العقد", "آخر موعد للإشعار", "نهاية العقد", "الحالة"],
      alerts.renewals.map((r) => [party(r), r.noticeDeadline, r.endDate, `${status(r)}${r.autoRenew ? (en ? " · auto-renews" : " · يتجدد تلقائياً") : ""}`]),
    ));
  }

  const intro = en ? `Lease alerts for <strong>${name}</strong> as of ${alerts.today}.` : `تنبيهات الإيجارات لشركة <strong>${name}</strong> بتاريخ ${alerts.today}.`;
  const link = `<p style="font-size:13px;"><a href="${escapeHtml(screenUrl)}" style="color:#0F4C5C;">${en ? "Open the lease contracts screen" : "فتح شاشة عقود الإيجار"}</a></p>`;
  const subjectBits = [
    alerts.overdue.length ? (en ? `${alerts.overdue.length} overdue` : `${alerts.overdue.length} متأخرة`) : "",
    alerts.dueSoon.length ? (en ? `${alerts.dueSoon.length} due soon` : `${alerts.dueSoon.length} مستحقة قريباً`) : "",
    collectOverdue.length + collectSoon.length ? (en ? `${collectOverdue.length + collectSoon.length} collections` : `${collectOverdue.length + collectSoon.length} تحصيل`) : "",
    alerts.renewals.length ? (en ? `${alerts.renewals.length} renewals` : `${alerts.renewals.length} تجديد`) : "",
  ].filter(Boolean).join(en ? ", " : "، ");
  return {
    subject: en ? `Lease alerts — ${companyName} — ${subjectBits}` : `تنبيهات الإيجارات — ${companyName} — ${subjectBits}`,
    bodyHtml: `<p style="font-size:14px;">${intro}</p>${parts.join("")}${link}`,
  };
}
