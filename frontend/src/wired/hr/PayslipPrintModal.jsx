import React from "react";
import { useTranslation } from "react-i18next";
import { PrintShell } from "../../legacy/shared";
import "./payslipPrint.css";
import { formatDate } from "../../i18n/dateFormat";
import { amountInWords } from "../../lib/amountInWords";

const DATE_OPTS = { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Riyadh" };

/**
 * إشعار تسليم راتب (Pay Slip) — صفحة A4 طولية لكل موظف: ١) بيانات الموظف ٢) بيانات الراتب ٣) إقرار الاستلام
 * والتوقيع. البنود تأتي من أعمدة المسير نفسها (displayColumns: تخصيص الشركة لترتيب الأعمدة وتسميتها)، فلا يختلف
 * الإشعار عن المسير. بيانات الهوية تُقرأ من قائمة الموظفين (للأدوار التي تملك صلاحية الموارد البشرية فقط، غيرهم
 * يصلهم ملخص بلا هوية فتظهر "—").
 */
export default function PayslipPrintModal({ run, rows, columns, employees, employeeIds, month, company, onClose }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar"), L = (a, e) => (ar ? a : e), lang = ar ? "ar" : "en";
  const money = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (d) => (d ? formatDate(d, "en", DATE_OPTS) : "—");
  const methods = { bank: L("تحويل بنكي", "Bank transfer"), mudad: L("مدد", "Mudad"), cash: L("نقدًا", "Cash"), unspecified: L("غير محدد", "Unspecified") };
  const genders = { male: L("ذكر", "Male"), female: L("أنثى", "Female") };
  const gender = (g) => { const v = String(g || "").trim().toLowerCase(); if (["male", "m", "ذكر"].includes(v)) return genders.male; if (["female", "f", "أنثى", "انثى"].includes(v)) return genders.female; return g || "—"; };
  const monthLabel = month ? formatDate(`${month}-01`, lang, { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const accent = company?.brandColor || "#1f6f8b";
  const byId = new Map((employees || []).map((e) => [e.id, e]));
  const selected = employeeIds?.length ? rows.filter((r) => employeeIds.includes(r.employeeId)) : rows;
  const lines = (r, kind) => columns.filter((c) => c.kind === kind).map((c) => ({ id: c.id, name: c.name, value: Number(r.componentValues?.[c.id] || 0) })).filter((l) => l.value !== 0);
  const draft = run?.status !== "posted";
  const companyName = (!ar && company?.nameEn) || company?.name || "";

  return (
    <PrintShell company={company} hideHeader showSignatures={false} onClose={onClose}>
      <div className="payslip-stack" dir={ar ? "rtl" : "ltr"} lang={lang} style={{ "--ps-accent": accent }}>
        {selected.map((r) => {
          const e = byId.get(r.employeeId) || {};
          const additions = lines(r, "addition"), deductions = lines(r, "deduction");
          const method = r.paymentMethod || e.payrollPaymentMethod || "unspecified";
          const net = Number(r.net || 0);
          const words = amountInWords(net, lang);
          const info = [
            [L("رقم الهوية", "ID number"), e.idNumber || "—", true],
            [L("الجنسية", "Nationality"), e.nationality || "—"],
            [L("الجنس", "Gender"), gender(e.gender)],
            [L("تاريخ الميلاد", "Date of birth"), date(e.dateOfBirth), true],
            [L("المهنة", "Job title"), r.jobTitle || e.jobTitle || "—"],
            [L("القسم", "Department"), e.departmentRef?.name || e.department || "—"],
            [L("الرقم الوظيفي", "Employee no."), r.employeeNumber || e.employeeNumber || "—", true],
            [L("تاريخ الالتحاق", "Join date"), date(e.hireDate), true],
          ];
          return (
            <section className="payslip" key={r.employeeId}>
              <header className="ps-head">
                <div className="ps-co"><h1>{companyName}</h1>{company?.vatNumber && <p>{L("الرقم الضريبي", "VAT No.")}: {company.vatNumber}</p>}</div>
                {company?.logoUrl && <div className="ps-logo"><img src={company.logoUrl} alt={companyName} /></div>}
              </header>
              <div className="ps-title"><b>{L("إشعار تسليم راتب", "Pay Slip")}</b><span>{monthLabel}{draft && ` · ${L("مسودة", "Draft")}`}</span></div>

              <h2 className="ps-sec">{L("أولًا: بيانات الموظف", "1. Employee details")}</h2>
              <div className="ps-grid">
                <div className="ps-cell ps-wide"><small>{L("اسم الموظف", "Employee name")}</small><div>{r.employeeName}</div></div>
                {info.map(([label, value, ltr]) => <div className="ps-cell" key={label}><small>{label}</small><div className={ltr ? "ps-num" : ""}>{value}</div></div>)}
              </div>

              <h2 className="ps-sec">{L("ثانيًا: بيانات الراتب", "2. Salary details")}</h2>
              <div className="ps-meta">
                <div><small>{L("فترة الراتب", "Pay period")}</small><b>{monthLabel}</b></div>
                <div><small>{L("أيام العمل", "Days worked")}</small><b>{r.workedDays ?? "—"}{r.standardDays ? ` / ${r.standardDays}` : ""}</b></div>
                <div><small>{L("طريقة الصرف", "Payment method")}</small><b>{methods[method] || methods.unspecified}</b></div>
              </div>
              <div className="ps-two">
                <table><thead><tr><th colSpan="2">{L("المستحقات", "Earnings")}</th></tr></thead><tbody>
                  {additions.map((l) => <tr key={l.id}><td>{l.name}</td><td className="ps-v">{money(l.value)}</td></tr>)}
                  {additions.length === 0 && <tr><td colSpan="2" className="ps-empty">—</td></tr>}
                  <tr className="ps-tot"><td>{L("إجمالي المستحق", "Gross pay")}</td><td className="ps-v">{money(r.totalAdditions)}</td></tr></tbody></table>
                <table><thead><tr><th colSpan="2">{L("الاستقطاعات", "Deductions")}</th></tr></thead><tbody>
                  {deductions.map((l) => <tr key={l.id}><td>{l.name}</td><td className="ps-v">{money(l.value)}</td></tr>)}
                  {deductions.length === 0 && <tr><td colSpan="2" className="ps-empty">—</td></tr>}
                  <tr className="ps-tot"><td>{L("إجمالي الاستقطاعات", "Total deductions")}</td><td className="ps-v">{money(r.totalDeductions)}</td></tr></tbody></table>
              </div>
              <div className="ps-net"><div><div className="ps-net-l">{L("صافي الراتب", "Net salary")} — {methods[method] || methods.unspecified}</div><div className="ps-net-w">{words}</div></div><div className="ps-net-amt">{money(net)} <span>SAR</span></div></div>

              <h2 className="ps-sec">{L("ثالثًا: إقرار الاستلام", "3. Acknowledgement of receipt")}</h2>
              <div className="ps-ack">
                {method === "cash"
                  ? ar ? <>أقر أنا الموقع أدناه <b>{r.employeeName}</b>، حامل الهوية رقم <b className="ps-num">{e.idNumber || "—"}</b>، بأنني استلمت من {companyName} مبلغ <b>{money(net)} ريال سعودي</b> ({words}) نقدًا، وهو صافي راتبي عن شهر {monthLabel}، استلامًا تامًا نافيًا للجهالة.</>
                    : <>I, the undersigned <b>{r.employeeName}</b>, ID no. <b className="ps-num">{e.idNumber || "—"}</b>, acknowledge receiving from {companyName} the amount of <b>SAR {money(net)}</b> ({words}) in cash, being my net salary for {monthLabel}, in full settlement.</>
                  : ar ? <>أقر أنا الموقع أدناه <b>{r.employeeName}</b>، حامل الهوية رقم <b className="ps-num">{e.idNumber || "—"}</b>، باستلامي إشعار راتب شهر {monthLabel}، وأن صافي الراتب البالغ <b>{money(net)} ريال سعودي</b> ({words}) يُصرف بطريقة: <b>{methods[method]}</b>.</>
                    : <>I, the undersigned <b>{r.employeeName}</b>, ID no. <b className="ps-num">{e.idNumber || "—"}</b>, acknowledge receiving the pay slip for {monthLabel}; the net salary of <b>SAR {money(net)}</b> ({words}) is paid by: <b>{methods[method]}</b>.</>}
              </div>
              <div className="ps-sig">
                <div><span>{L("اسم المستلم", "Employee name")}: {r.employeeName}</span></div>
                <div><span>{L("التوقيع", "Signature")}</span></div>
                <div><span>{L("تاريخ الاستلام", "Date received")}: &nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;/</span></div>
              </div>
              <div className="ps-appr">
                {[L("إعداد", "Prepared by"), L("مراجعة الموارد البشرية", "HR review"), L("مراجعة المالية", "Finance review"), L("الاعتماد", "Approved by")].map((h) => <div key={h}><small>{h}</small><i /></div>)}
              </div>
            </section>
          );
        })}
        {selected.length === 0 && <p>{L("لا يوجد موظفون في هذا المسير.", "No employees in this payroll run.")}</p>}
      </div>
    </PrintShell>
  );
}
