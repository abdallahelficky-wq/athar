import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { getFiscalYears, updateFiscalYearSettings, closeFiscalYear, reopenLastFiscalYear } from "../api/companies";
import { fmt } from "../legacy/constants";

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * إعداد السنة المالية وإقفالها داخل بيانات الشركة: شهر البداية، حساب الإقفال، إقفال السنة التالية بعد معاينة
 * أرقامها، وإعادة فتح آخر سنة مقفلة (مدير النظام فقط). المنطق المحاسبي كله على الخادم (fiscalYears.service.ts).
 */
export default function FiscalYearPanel({ companyId, onClosingDateChange }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const text = (arabic, english) => (ar ? arabic : english);
  const months = ar ? MONTHS_AR : MONTHS_EN;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [data, setData] = useState(null);
  const [startMonth, setStartMonth] = useState(1);
  const [closeAccountId, setCloseAccountId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = (overview) => {
    setData(overview);
    setStartMonth(overview.fiscalYearStartMonth);
    setCloseAccountId(overview.fiscalCloseAccountId || overview.suggestedCloseAccountId || "");
    onClosingDateChange?.(overview.fiscalYearClosingDate || "");
  };

  useEffect(() => {
    let live = true;
    setError("");
    getFiscalYears(companyId).then((o) => { if (live) apply(o); }).catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const run = async (kind, fn, success) => {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      apply(await fn());
      setNotice(success);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  if (!data) return error ? <p className="balance-bad">{error}</p> : null;

  const next = data.nextClosing;
  const accountName = (id) => {
    const a = data.closeAccounts.find((x) => x.id === id);
    return a ? `${a.code} — ${ar ? a.name : a.nameEn || a.name}` : "";
  };
  const hasClosings = data.closings.length > 0;
  const settingsChanged = startMonth !== data.fiscalYearStartMonth || (closeAccountId || null) !== (data.fiscalCloseAccountId || null);

  const saveSettings = () => run("settings", () => updateFiscalYearSettings(companyId, { fiscalYearStartMonth: Number(startMonth), fiscalCloseAccountId: closeAccountId || null }), text("تم حفظ إعداد السنة المالية.", "Fiscal year settings saved."));

  const close = () => {
    const net = next.netIncome;
    const msg = text(
      `سيتم إقفال السنة المالية ${next.year.label} (${next.year.start} — ${next.year.end}):\n` +
        `• قيد إقفال بتاريخ ${next.year.end} يصفّر الإيرادات (${fmt(next.totalRevenue)}) والمصروفات (${fmt(next.totalExpense)})\n` +
        `• ${net >= 0 ? "صافي الربح" : "صافي الخسارة"} ${fmt(Math.abs(net))} يُرحَّل إلى ${accountName(closeAccountId)}\n` +
        `• تُقفَل الفترة حتى ${next.year.end} فلا يُضاف قيد فيها\n\nمتابعة؟`,
      `Close fiscal year ${next.year.label} (${next.year.start} — ${next.year.end})?\n` +
        `• A closing entry dated ${next.year.end} zeroes revenue (${fmt(next.totalRevenue)}) and expenses (${fmt(next.totalExpense)})\n` +
        `• ${net >= 0 ? "Net profit" : "Net loss"} of ${fmt(Math.abs(net))} goes to ${accountName(closeAccountId)}\n` +
        `• The period through ${next.year.end} is locked`,
    );
    if (!window.confirm(msg)) return;
    run("close", () => closeFiscalYear(companyId, { yearEnd: next.year.end, closeAccountId: closeAccountId || null }), text(`تم إقفال السنة ${next.year.label} وفتح السنة التالية.`, `Fiscal year ${next.year.label} closed; the next year is open.`));
  };

  const reopen = () => {
    const last = data.closings[0];
    const msg = text(
      `سيتم حذف قيد إقفال السنة ${last.year.label}${last.entryNumber ? ` (${last.entryNumber})` : ""} وإعادة تاريخ القفل إلى ما كان عليه قبل إقفالها. متابعة؟`,
      `This deletes the closing entry of ${last.year.label}${last.entryNumber ? ` (${last.entryNumber})` : ""} and restores the lock date from before it was closed. Continue?`,
    );
    if (!window.confirm(msg)) return;
    run("reopen", () => reopenLastFiscalYear(companyId), text(`أُعيد فتح السنة ${last.year.label}.`, `Fiscal year ${last.year.label} reopened.`));
  };

  return (
    <>
      <h4 className="sub-head">{text("السنة المالية", "Fiscal year")}</h4>
      <p className="note">
        {text(
          "أرصدة حسابات المركز المالي تنتقل للسنة التالية تلقائياً لأن الدفتر تراكمي — لا يلزم قيد افتتاحي. الإقفال يصفّر الإيرادات والمصروفات في حساب الإقفال بقيد بتاريخ نهاية السنة، ويقفل الفترة، فتبدأ السنة الجديدة بقائمة دخل من الصفر.",
          "Balance sheet balances carry into the next year automatically because the ledger is cumulative, so no opening entry is needed. Closing zeroes revenue and expenses into the closing account with an entry dated at year end and locks the period, so the new year's income statement starts from zero.",
        )}
      </p>
      <div className="form-grid">
        <label>{text("شهر بداية السنة المالية", "Fiscal year starts in")}
          <select value={startMonth} disabled={hasClosings} onChange={(e) => setStartMonth(Number(e.target.value))}>
            {months.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label>{text("حساب الإقفال (أرباح وخسائر العام)", "Closing account (current year profit/loss)")}
          <select value={closeAccountId} onChange={(e) => setCloseAccountId(e.target.value)}>
            <option value="">{text("— اختر حساب حقوق ملكية —", "— Choose an equity account —")}</option>
            {data.closeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {ar ? a.name : a.nameEn || a.name}</option>)}
          </select>
        </label>
        <label>{text("السنة المالية الحالية", "Current fiscal year")}
          <input readOnly dir="ltr" value={`${data.currentYear.start} — ${data.currentYear.end}`} />
        </label>
      </div>
      {hasClosings && <p className="note">{text("شهر البداية لا يتغيّر بعد إقفال سنة.", "The start month can't change once a year is closed.")}</p>}
      {settingsChanged && (
        <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="btn-primary" onClick={saveSettings} disabled={!!busy}>{busy === "settings" ? text("جارٍ الحفظ…", "Saving…") : text("حفظ إعداد السنة المالية", "Save fiscal year settings")}</button>
        </div>
      )}

      {next ? (
        <div className="panel" style={{ marginTop: 8 }}>
          <h5>{text(`السنة التالية للإقفال: ${next.year.label}`, `Next year to close: ${next.year.label}`)} <span dir="ltr">({next.year.start} — {next.year.end})</span></h5>
          <table className="ledger-table">
            <tbody>
              <tr><td>{text("إجمالي الإيرادات", "Total revenue")}</td><td className="num">{fmt(next.totalRevenue)}</td></tr>
              <tr><td>{text("إجمالي المصروفات", "Total expenses")}</td><td className="num">{fmt(next.totalExpense)}</td></tr>
              <tr className="net-row"><td className="strong">{next.netIncome >= 0 ? text("صافي الربح", "Net profit") : text("صافي الخسارة", "Net loss")}</td><td className="num strong">{fmt(Math.abs(next.netIncome))}</td></tr>
              <tr><td>{text("أسطر حسابات تُقفَل", "Account lines to close")}</td><td className="num">{next.accountLines}</td></tr>
            </tbody>
          </table>
          {next.blockers.includes("not_ended") && <p className="note">{text(`لا تُقفَل السنة قبل انتهائها (${next.year.end}). الأرقام أعلاه حتى اليوم.`, `The year can't be closed before it ends (${next.year.end}). Figures above are to date.`)}</p>}
          {next.blockers.includes("drafts") && <p className="balance-bad">{text(`توجد ${next.draftCount} قيود محفوظة غير مرحّلة داخل السنة — رحّلها أو احذفها قبل الإقفال.`, `${next.draftCount} saved, unposted entries are in this year. Post or delete them before closing.`)}</p>}
          <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="btn-primary" onClick={close} disabled={!!busy || next.blockers.length > 0 || !closeAccountId || settingsChanged}>
              {busy === "close" ? text("جارٍ الإقفال…", "Closing…") : text(`إقفال السنة ${next.year.label}`, `Close ${next.year.label}`)}
            </button>
          </div>
          {settingsChanged && <p className="note">{text("احفظ إعداد السنة المالية أولاً.", "Save the fiscal year settings first.")}</p>}
        </div>
      ) : (
        <p className="note">{text("لا توجد قيود بعد — لا توجد سنة لإقفالها.", "No entries yet, so there's no year to close.")}</p>
      )}

      {hasClosings && (
        <>
          <h5>{text("السنوات المقفلة", "Closed years")}</h5>
          <table className="ledger-table">
            <thead>
              <tr><th>{text("السنة", "Year")}</th><th>{text("الفترة", "Period")}</th><th>{text("قيد الإقفال", "Closing entry")}</th><th>{text("صافي الربح/الخسارة", "Net profit/loss")}</th><th>{text("حساب الإقفال", "Closing account")}</th></tr>
            </thead>
            <tbody>
              {data.closings.map((c) => (
                <tr key={c.id}>
                  <td>{c.year.label}</td>
                  <td dir="ltr">{c.year.start} — {c.year.end}</td>
                  <td>{c.entryNumber || text("بلا قيد (لا أرصدة)", "None (no balances)")}</td>
                  <td className="num">{fmt(c.netIncome)}</td>
                  <td>{accountName(c.closeAccountId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <div className="form-btn-group" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="btn-ghost" onClick={reopen} disabled={!!busy}>
                {busy === "reopen" ? text("جارٍ إعادة الفتح…", "Reopening…") : text(`إعادة فتح السنة ${data.closings[0].year.label}`, `Reopen ${data.closings[0].year.label}`)}
              </button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="balance-bad">{error}</p>}
      {notice && <p role="status" className="note">{notice}</p>}
    </>
  );
}
