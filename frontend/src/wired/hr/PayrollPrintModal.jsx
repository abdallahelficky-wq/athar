import React from "react";
import { useTranslation } from "react-i18next";
import { PrintShell } from "../../legacy/shared";
import "./payrollPrint.css";

export default function PayrollPrintModal({ run, rows, totals, columns, month, company, onClose }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar"), L = (a,e) => ar ? a : e;
  const money = v => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });
  const key = c => c.systemKey || ({ basicSalary: "basic", housingAllowance: "housing", transportAllowance: "transport" }[c.sourceEmployeeField]) || (c.id.startsWith("legacy:") ? c.id.slice(7) : "");
  const amount = (r,k) => columns.filter(c => key(c) === k).reduce((s,c) => s + Number(r.componentValues[c.id] || 0),0);
  const methods = { bank:L("تحويل بنكي","Bank transfer"), mudad:L("مدد","Mudad"), cash:L("نقدي","Cash"), unspecified:L("غير محدد","Unspecified") };
  const data = rows.map(r => {
    const basic=amount(r,"basic"),housing=amount(r,"housing"),transport=amount(r,"transport"),advance=amount(r,"advance"),gosi=amount(r,"gosi");
    return {r, values:[r.monthlyBasic,basic,housing,transport,r.totalAdditions-basic-housing-transport,r.totalAdditions,advance,gosi,r.totalDeductions-advance-gosi,r.net]};
  });
  const headings = ["#",L("الموظف","Employee"),L("الرقم","Number"),L("الوظيفة","Job title"),L("الأيام","Days"),L("الأساسي الشهري","Monthly basic"),L("الأساسي المستحق","Earned basic"),L("السكن","Housing"),L("النقل","Transport"),L("إضافات أخرى","Other additions"),L("الإجمالي","Gross"),L("السلف","Advances"),L("تأمينات الموظف","Employee GOSI"),L("حسميات أخرى","Other deductions"),L("الصافي","Net"),L("الصرف","Payment")];
  return <PrintShell company={company} landscape hideHeader showSignatures={false} onClose={onClose}>
    <section className="payroll-report" dir={ar ? "rtl":"ltr"} lang={ar ? "ar":"en"}>
      <header className="payroll-report-head"><div>{company?.logoUrl && <img src={company.logoUrl} alt={company.name || ""}/>}</div><div><h1>{L("مسير الرواتب","Payroll register")}</h1><strong>{company?.name}</strong><p>{month} · {run.status === "posted" ? L("مرحّل","Posted") : L("مسودة — غير مرحّلة","Draft — not posted")}</p></div><div>{L("تاريخ الطباعة","Print date")}<br/>{new Date().toLocaleDateString("en-GB",{timeZone:"Asia/Riyadh"})}<br/>{L("العملة: ريال سعودي","Currency: SAR")}{rows[0]?.standardDays && <><br/>{L("أساس الشهر", "Month basis")}: {rows[0].standardDays} {L("يومًا", "days")}</>}</div></header>
      <div className="payroll-report-stats">{[[L("عدد الموظفين","Employees"),rows.length],[L("إجمالي المستحق","Gross pay"),money(totals?.totalAdditions)],[L("إجمالي الخصومات","Deductions"),money(totals?.totalDeductions)],[L("صافي الرواتب","Net pay"),money(totals?.net)]].map(([h,v])=><div key={h}><small>{h}</small><strong>{v}</strong></div>)}</div>
      <table><thead><tr>{headings.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.map(({r,values},i)=><tr key={r.employeeId}><td>{i+1}</td><td className="payroll-name">{r.employeeName}</td><td>{r.employeeNumber || "—"}</td><td>{r.jobTitle || "—"}</td><td>{r.workedDays ?? "—"}</td>{values.map((v,j)=><td className="payroll-number" key={j}>{v == null ? "—" : money(v)}</td>)}<td>{methods[r.paymentMethod || "unspecified"]}</td></tr>)}</tbody><tfoot><tr><th colSpan={5}>{L("الإجمالي","Total")}</th>{Array.from({length:10},(_,i)=><th className="payroll-number" key={i}>{money(data.reduce((s,d)=>s+Number(d.values[i] || 0),0))}</th>)}<th/></tr></tfoot></table>
      <div className="payroll-report-payments">{Object.entries(methods).filter(([id])=>id!=="unspecified" || rows.some(r=>!r.paymentMethod)).map(([id,h])=><div key={id}>{h}<strong>{money(rows.filter(r=>(r.paymentMethod || "unspecified")===id).reduce((s,r)=>s+r.net,0))}</strong></div>)}</div>
      <div className="payroll-report-signatures">{[L("إعداد","Prepared by"),L("مراجعة الموارد البشرية","HR review"),L("مراجعة المالية","Finance review"),L("الاعتماد","Approved by")].map(h=><div key={h}>{h}<span>________________</span></div>)}</div>
    </section>
  </PrintShell>;
}
