import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import HRDialog from "./HRDialog";
import { PrintShell } from "../../legacy/shared";
import { listEmployees } from "../../api/employees";
import { previewAnnualLeave, saveAnnualLeaveDraft, listAnnualLeaveDrafts, updateAnnualLeaveDraft, deleteAnnualLeaveDraft } from "../../api/leaveSettlements";
import { useAuth } from "../../context/AuthContext";
import { DEPARTMENT_KEYS } from "../../legacy/constants";
import { NATIONALITY_KEYS } from "../../legacy/hr";
import { labelForListValue } from "../../legacy/listLabels";
import "./annualLeave.css";

// أسماء البنود النظامية بالإنجليزية (نفس مفاتيح legacyPayrollComponents) — أي بند يضيفه المستخدم يُعرض باسمه كما هو.
const COMPONENT_EN = { basic: "Basic salary", housing: "Housing allowance", transport: "Transport allowance", otherAllow: "Other allowances",
  otherAdd: "Other additions & incentives", overtime: "Overtime", advance: "Employee advances", advanceInstallments: "Advance installments",
  violation: "Violations deduction", penalty: "Penalties deduction", otherDed: "Other deductions", gosi: "GOSI", absence: "Absence deduction" };
const FIELD_KEY = { basicSalary: "basic", housingAllowance: "housing", transportAllowance: "transport", otherAllowance: "otherAllow" };
const componentLabel = (line, ar) => {
  if (ar) return line.name;
  const key = line.systemKey || FIELD_KEY[line.sourceEmployeeField] || (String(line.id).startsWith("legacy:") ? String(line.id).slice(7) : "");
  return COMPONENT_EN[key] || line.name;
};
const money = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function Summary({ data, L, t, ar }) {
  const e = data.employee, b = data.balance, s = data.salary, r = data.request;
  const row = (label, value) => <div className="annual-leave-row" key={label}><span>{label}</span><strong>{value ?? "—"}</strong></div>;
  const warnings = {
    salary_already_posted: L("راتب هذا الشهر مرحّل بالفعل؛ لم يُضف إلى صافي التسوية لتجنب التكرار.", "This salary month is already posted and is excluded from this settlement to prevent duplication."),
    missing_installment: L("توجد سلفة بلا قسط محدد؛ لا تخصم تلقائيًا قبل تحديد القسط.", "An advance has no installment; specify it before it can be deducted."),
    on_leave: L("الموظف في إجازة حاليًا؛ راجع المباشرة قبل اعتماد أي تسوية جديدة.", "The employee is currently on leave. Review their return before approving another settlement."),
    negative_salary: L("خصومات الراتب تتجاوز المستحق؛ راجعها قبل الاعتماد.", "Salary deductions exceed earnings; review before approval."),
  };
  return <section className="annual-leave-summary">
    <p className="annual-leave-draft-note">{L("مسودة للمراجعة — لم تُرحّل ولم تُصرف ولا تحجز رصيد الإجازة", "Review draft — not posted or paid; does not reserve leave balance")}</p>
    {data.warnings.map(w => <p role="status" className="annual-leave-warning" key={w}>{warnings[w]}</p>)}
    <h3>{L("بيانات الموظف", "Employee details")}</h3>
    <div className="annual-leave-grid">{[
      [L("الموظف", "Employee"), e.name], [L("الرقم الوظيفي", "Employee number"), e.employeeNumber],
      [L("الوظيفة", "Job title"), ar ? e.jobTitle : (e.jobTitleEn || e.jobTitle)],
      [L("القسم", "Department"), ar ? e.department : (e.departmentEn || (e.department && labelForListValue(t, DEPARTMENT_KEYS, "hr.departmentLabels", e.department)))],
      [L("الجنسية", "Nationality"), e.nationality && labelForListValue(t, NATIONALITY_KEYS, "hr.nationalityLabels", e.nationality)], [L("تاريخ المباشرة", "Hire date"), e.hireDate],
      [L("آخر إجازة", "Last leave"), e.lastLeaveDate], [L("آخر مباشرة بعد إجازة", "Last return"), e.lastReturnDate],
      [L("تاريخ الإجازة", "Leave date"), r.leaveStartDate], [L("نهاية الإجازة", "Leave end"), r.leaveEndDate],
      [L("نهاية العقد", "Contract end"), e.contractEnd],
    ].map(([l,v])=>row(l,v))}</div>
    <h3>{L("الراتب الشهري التفصيلي", "Monthly salary package")}</h3>
    <div className="annual-leave-grid">{[[L("الأساسي", "Basic"),e.pay.basic],[L("السكن", "Housing"),e.pay.housing],[L("النقل", "Transport"),e.pay.transport],[L("بدلات أخرى", "Other allowances"),e.pay.other],[L("الإجمالي", "Gross"),e.pay.total]].map(([l,v])=>row(l,money(v)))}</div>
    <h3>{L("رصيد الإجازة وتسويته", "Leave balance and settlement")}</h3>
    <div className="annual-leave-grid">{[
      [L("بداية فترة الرصيد", "Balance period starts"),b.anchorDate], [L("الصرف حتى تاريخ", "Settle through"),b.throughDate],
      [L("مرحل سابق — أيام", "Carried forward — days"),money(b.carryDays)], [L("مرحل سابق — مبلغ", "Carried forward — amount"),money(b.carryAmount)],
      [L("مكتسب بعد بداية الفترة — أيام", "Earned in period — days"),money(b.earnedDays)],
      [L("الرصيد المتاح — أيام", "Available — days"),money(b.availableDays)], [L("الرصيد المتاح — مبلغ", "Available — amount"),money(b.availableAmount)],
      [L("سعر يوم الإجازة", "Leave daily rate"),`${money(b.daily)} / ${L("مقسوم", "divisor")} ${b.divisor}`],
      [L("المطلوب صرفه — أيام", "To settle — days"),money(b.payDays)], [L("بدل الإجازة", "Leave pay"),money(b.payAmount)],
      [L("المتبقي للإجازة التالية — أيام", "Remaining for next leave — days"),money(b.remainingDays)], [L("المتبقي للإجازة التالية — مبلغ", "Remaining for next leave — amount"),money(b.remainingAmount)],
    ].map(([l,v])=>row(l,v))}</div>
    <h3>{L("راتب الشهر", "Monthly payroll")} · {s.month} · {s.days} {L("يوم", "days")}</h3>
    {s.lines.map(line=>row(componentLabel(line, ar), `${line.kind === "deduction" ? "−" : "+"}${money(line.amount)}`))}
    {row(L("إجمالي الراتب المستحق", "Salary earnings"),money(s.additions))}
    {row(L("السلف والخصومات", "Advances and deductions"),money(s.deductions))}
    {row(L("صافي الراتب", "Net salary"),money(s.net))}
    <h3>{L("التذكرة والإضافات", "Ticket and additions")}</h3>
    {row(L("تعويض التذكرة", "Ticket compensation"),money(r.ticketAmount))}
    {row(L("إضافات أخرى", "Other additions"),money(r.otherAdditions))}
    {r.additionsReason && row(L("سبب الإضافات", "Reason for additions"),r.additionsReason)}
    <div className="annual-leave-total">{row(L("صافي المستحق", "Net entitlement"),money(data.net))}</div>
  </section>;
}

const EMPTY_FORM = { leaveStartDate:"", employeeId:"", balanceMode:"all", salaryMode:"until_leave", ticketAmount:0, otherAdditions:0, additionsReason:"", openingDays:0, openingAmount:0 };

export default function AnnualLeaveDraft({ companyId, company }) {
  const { t, i18n } = useTranslation(), ar = i18n.language.startsWith("ar"), L = (a,e)=> ar ? a:e;
  const { user } = useAuth();
  const [editingId,setEditingId]=useState(null), [confirmDeleteId,setConfirmDeleteId]=useState(null);
  const [open,setOpen]=useState(false), [employees,setEmployees]=useState([]), [drafts,setDrafts]=useState([]);
  const [form,setForm]=useState(EMPTY_FORM);
  const [preview,setPreview]=useState(null), [printing,setPrinting]=useState(null), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  const [saved,setSaved]=useState(false);
  useEffect(()=>{
    let current=true;
    setOpen(false);setPreview(null);setPrinting(null);setEmployees([]);setDrafts([]);setError("");
    if(companyId) Promise.all([listEmployees(companyId),listAnnualLeaveDrafts(companyId)]).then(([es,ds])=>{if(current){setEmployees(es);setDrafts(ds);}}).catch(e=>{if(current)setError(e.message);});
    return()=>{current=false;};
  },[companyId]);
  const change=(key,value)=>{setForm(f=>({...f,[key]:value}));setSaved(false);};
  useEffect(()=>{
    let current=true;setPreview(null);setError("");
    if(!open || !form.employeeId || !form.leaveStartDate) return;
    setBusy(true);
    const timer=setTimeout(()=>{
      const request={...form,companyId};
      for(const key of ["salaryMonth","leaveEndDate","balanceThroughDate","openingDate"]) if(!request[key])delete request[key];
      previewAnnualLeave(request).then(p=>{if(current)setPreview(p);}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setBusy(false);});
    },250);
    return()=>{current=false;clearTimeout(timer);};
  },[form,companyId,open]);
  const save=async()=>{
    if(!preview || busy)return;setBusy(true);setError("");
    try{
      if(editingId){const d=await updateAnnualLeaveDraft(editingId,preview.request);setDrafts(ds=>ds.map(x=>x.id===d.id?d:x));setPreview(d.snapshot);}
      else{const d=await saveAnnualLeaveDraft(preview.request);setDrafts(ds=>[d,...ds]);setEditingId(d.id);setPreview(d.snapshot);}
      setSaved(true);
    }
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const startEdit=d=>{setForm({...EMPTY_FORM,...d.request});setEditingId(d.id);setSaved(false);setConfirmDeleteId(null);setError("");setOpen(true);};
  const remove=async d=>{
    setBusy(true);setError("");
    try{await deleteAnnualLeaveDraft(d.id);setDrafts(ds=>ds.filter(x=>x.id!==d.id));setConfirmDeleteId(null);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const field=(label,key,type="date",extra={})=><label>{label}<input type={type} value={form[key] ?? ""} onChange={e=>change(key,e.target.value)} {...extra}/></label>;
  return <div className="panel annual-leave-workflow" dir={ar?"rtl":"ltr"}>
    <h3>{L("إعداد الإجازة السنوية", "Prepare annual leave")}</h3>
    <p>{L("حدد تاريخ الإجازة ثم الموظف. راجع الرصيد والراتب والإضافات، واحفظ مسودة أو اطبعها قبل الاعتماد.", "Choose the leave date, then the employee. Review balances, salary and additions, then save or print a draft.")}</p>
    <button className="btn-primary" onClick={()=>{setForm(EMPTY_FORM);setEditingId(null);setSaved(false);setOpen(true);}}>{L("إعداد مسودة إجازة", "New leave draft")}</button>
    {error&&!open&&<p role="alert">{error}</p>}
    {drafts.length>0&&<table className="ledger-table"><thead><tr><th>{L("الموظف","Employee")}</th><th>{L("تاريخ الإجازة","Leave date")}</th><th>{L("الصافي","Net")}</th><th/></tr></thead><tbody>{drafts.map(d=><tr key={d.id}><td>{d.snapshot.employee.name}</td><td>{d.snapshot.request.leaveStartDate}</td><td>{money(d.snapshot.net)}</td><td className="row-actions"><button className="btn-ghost" onClick={()=>setPrinting(d.snapshot)}>{L("عرض / طباعة المسودة","View / print draft")}</button>
      {d.createdBy===user?.id&&<>
        <button className="btn-ghost" disabled={busy} onClick={()=>startEdit(d)}>{L("تعديل","Edit")}</button>
        {confirmDeleteId===d.id
          ? <><button className="btn-ghost text-danger" disabled={busy} onClick={()=>remove(d)}>{L("تأكيد الحذف","Confirm delete")}</button><button className="btn-ghost" onClick={()=>setConfirmDeleteId(null)}>{L("تراجع","Cancel")}</button></>
          : <button className="btn-ghost" disabled={busy} onClick={()=>setConfirmDeleteId(d.id)}>{L("حذف","Delete")}</button>}
      </>}</td></tr>)}</tbody></table>}
    {open&&<HRDialog title={editingId?L("تعديل مسودة الإجازة السنوية", "Edit annual leave draft"):L("إعداد الإجازة السنوية — مسودة", "Annual leave — draft")} onClose={()=>setOpen(false)}>
      <div className="form-grid">
        {field(L("1. تاريخ بداية الإجازة", "1. Leave start date"),"leaveStartDate")}
        <label>{L("2. الموظف", "2. Employee")}<select disabled={!form.leaveStartDate} value={form.employeeId} onChange={e=>{setForm(f=>({...f,employeeId:e.target.value,openingDate:"",openingDays:0,openingAmount:0}));setSaved(false);}}><option value="">{L("اختر الموظف", "Choose employee")}</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        {field(L("نهاية الإجازة (اختياري)", "Leave end (optional)"),"leaveEndDate","date",{min:form.leaveStartDate})}
      </div>
      {form.employeeId&&<>
      {employees.filter(e=>e.id===form.employeeId).map(e=><div className="preview-box" key={e.id}>
        <h3>{e.name}</h3><div className="annual-leave-grid">
        {[[L("تاريخ المباشرة","Hire date"),e.hireDate?.slice(0,10)], [L("الوظيفة","Job title"),e.jobTitle], [L("القسم","Department"),e.department],
        [L("الراتب الأساسي","Basic salary"),money(e.basicSalary)], [L("بدل السكن","Housing allowance"),money(e.housingAllowance)], [L("بدل النقل","Transport allowance"),money(e.transportAllowance)],
        [L("بدلات أخرى","Other allowances"),money(e.otherAllowance)], [L("آخر إجازة","Last leave"),preview?.employee.lastLeaveDate],
        [L("الرصيد المتاح — أيام","Available — days"),preview?money(preview.balance.availableDays):"…"], [L("الرصيد المتاح — مبلغ","Available — amount"),preview?money(preview.balance.availableAmount):"…"],
        ].map(([label,value])=><div className="annual-leave-row" key={label}><span>{label}</span><strong>{value||"—"}</strong></div>)}
        </div>
      </div>)}
      <h3>{L("3. الرصيد المطلوب صرفه", "3. Leave balance to settle")}</h3>
      <div className="form-grid"><label>{L("نطاق التسوية", "Settlement scope")}<select value={form.balanceMode} onChange={e=>change("balanceMode",e.target.value)}><option value="all">{L("كامل الرصيد حتى بدء الإجازة", "Full balance at leave start")}</option><option value="through_date">{L("حتى تاريخ محدد", "Through a specific date")}</option><option value="contract_year">{L("حتى نهاية العام التعاقدي المكتمل (آخر ذكرى سنوية للمباشرة) — والباقي يُرحّل", "Through end of the completed contract year (last employment anniversary) — rest carried forward")}</option></select></label>
      {form.balanceMode==="through_date"&&field(L("تاريخ احتساب الرصيد", "Balance cutoff date"),"balanceThroughDate","date",{max:form.leaveStartDate})}</div>
      {!preview?.balance.hasPrevious&&<details><summary>{L("رصيد افتتاحي لمن ليست له تسوية سابقة", "Opening balance when no previous settlement exists")}</summary><p>{L("يحل محل رصيد الفترة السابقة لتاريخه، ولا يُضاف مرة ثانية إلى رصيد الخدمة الكامل. يُحفظ في هذه المسودة فقط حتى الاعتماد.", "Replaces accrual before its date; it is not added to lifetime accrual. Saved in this draft only pending approval.")}</p><div className="form-grid">{field(L("تاريخ الرصيد", "Balance date"),"openingDate")}{field(L("الأيام", "Days"),"openingDays","number",{min:0,step:"0.01"})}{field(L("المبلغ", "Amount"),"openingAmount","number",{min:0,step:"0.01"})}</div></details>}
      <h3>{L("4. راتب الشهر", "4. Salary month")}</h3><div className="form-grid">{field(L("الشهر (افتراضيًا شهر الإجازة)", "Month (defaults to leave month)"),"salaryMonth","month",{max:form.leaveStartDate.slice(0,7)})}<label>{L("فترة الراتب", "Salary period")}<select value={form.salaryMode} onChange={e=>change("salaryMode",e.target.value)}><option value="until_leave">{L("حتى اليوم السابق للإجازة", "Until the day before leave")}</option><option value="full_month">{L("الشهر كاملًا", "Full month")}</option><option value="none">{L("دون راتب", "Exclude salary")}</option></select></label></div>
      <h3>{L("5. التذكرة والإضافات", "5. Ticket and additions")}</h3><div className="form-grid">{field(L("تعويض التذكرة", "Ticket compensation"),"ticketAmount","number",{min:0,step:"0.01"})}{field(L("إضافات أخرى", "Other additions"),"otherAdditions","number",{min:0,step:"0.01"})}<label>{L("سبب الإضافات (يظهر بالطباعة)", "Reason for additions (printed)")}<textarea maxLength={1000} value={form.additionsReason} onChange={e=>change("additionsReason",e.target.value)}/></label></div>
      </>}
      {busy&&<p role="status">{L("جارٍ احتساب المستحقات…", "Calculating…")}</p>}
      {error&&<p role="alert" className="balance-bad">{error}</p>}
      {preview&&<Summary data={preview} L={L} t={t} ar={ar}/>}
      <div className="hr-list-toolbar"><button className="btn-primary" disabled={!preview||busy||saved} onClick={save}>{saved?L("تم حفظ المسودة", "Draft saved"):editingId?L("حفظ التعديل دون ترحيل", "Save changes without posting"):L("حفظ مسودة دون ترحيل", "Save draft without posting")}</button><button className="btn-ghost" disabled={!preview||busy} onClick={()=>setPrinting(preview)}>{L("معاينة الطباعة", "Print preview")}</button></div>
    </HRDialog>}
    {printing&&<PrintShell company={company} subtitle={L("تسوية إجازة سنوية — مسودة", "Annual leave settlement — draft")} onClose={()=>setPrinting(null)}><div dir={ar?"rtl":"ltr"}><Summary data={printing} L={L} t={t} ar={ar}/></div></PrintShell>}
  </div>;
}
