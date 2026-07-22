import React, { useState } from "react";
import {
  COMPANIES, DEPARTMENTS, LEAVE_TYPES, TERMINATION_REASONS, ACTION_TYPES,
  calcEOS, serviceDuration, dailyRate, daysInMonth, monthLabel, accruedLeaveDays,
  employeeAccountBalance, fmt,
} from "./constants";
import { MiniDonut, MiniBarChart, PrintShell } from "./shared";

export const HR_TABS = [
  { id: "directory", label: "ملفات الموظفين" },
  { id: "leaves", label: "طلبات الإجازات" },
  { id: "leaveSettlement", label: "مستحقات الإجازة" },
  { id: "leaveReturn", label: "مباشرة بعد الإجازة" },
  { id: "actions", label: "إجراءات الموظفين" },
  { id: "payroll", label: "الرواتب" },
  { id: "eos", label: "نهاية الخدمة" },
  { id: "hrReports", label: "تقارير الموظفين" },
];

const EMPLOYEE_DOC_TYPES = ["إقامة", "جواز سفر", "رخصة قيادة", "بطاقة تشغيل سائق (نقل عام)", "شهادة صحية", "تأمين طبي", "أخرى"];
const NATIONALITIES = ["سعودي", "مصري", "باكستاني", "بنغلاديشي", "هندي", "يمني", "سوداني", "فلبيني", "أخرى"];

export function emptyEmployeeForm(companyId) {
  return {
    name: "", jobTitle: "", department: DEPARTMENTS[0],
    company: companyId === "all" ? "tesm" : companyId,
    hireDate: "2026-07-20", contractType: "unlimited", contractEnd: "",
    basicSalary: "", housingAllowance: "", transportAllowance: "", gosiApplicable: true,
    leaveStatus: "active", lastLeaveReturnDate: null,
    nationality: NATIONALITIES[0], dateOfBirth: "", bankName: "", bankAccount: "",
    documents: [],
  };
}

const daysUntil = (dateStr, todayStr = "2026-07-20") => Math.floor((new Date(dateStr) - new Date(todayStr)) / 86400000);

export function emptyDocRow() { return { type: EMPLOYEE_DOC_TYPES[0], number: "", expiryDate: "" }; }

export function collectExpiringEmployeeDocs(employees, companyId, withinDays = 30) {
  const list = companyId === "all" ? employees : employees.filter((e) => e.company === companyId);
  const rows = [];
  list.forEach((emp) => (emp.documents || []).forEach((d) => {
    if (!d.expiryDate) return;
    const days = daysUntil(d.expiryDate);
    if (days <= withinDays) rows.push({ employee: emp, doc: d, days });
  }));
  return rows.sort((a, b) => a.days - b.days);
}

export function collectExpiringCompanyDocs(companyDocuments, companyId, withinDays = 30) {
  const list = companyId === "all" ? companyDocuments : companyDocuments.filter((d) => d.company === companyId);
  return list
    .filter((d) => d.expiryDate)
    .map((d) => ({ doc: d, days: daysUntil(d.expiryDate) }))
    .filter((r) => r.days <= withinDays)
    .sort((a, b) => a.days - b.days);
}

export function EmployeeDirectory({ employees, setEmployees, companyId }) {
  const [form, setForm] = useState(emptyEmployeeForm(companyId));
  const [editingId, setEditingId] = useState(null);
  const [previewEmp, setPreviewEmp] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const list = companyId === "all" ? employees : employees.filter((e) => e.company === companyId);

  const resetForm = () => { setEditingId(null); setForm(emptyEmployeeForm(companyId)); };

  const startEdit = (emp) => {
    setEditingId(emp.id);
    setForm({ ...emptyEmployeeForm(companyId), ...emp, documents: emp.documents || [] });
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  const saveEmployee = () => {
    if (!form.name || !form.basicSalary) return;
    const cleaned = {
      ...form,
      basicSalary: Number(form.basicSalary),
      housingAllowance: Number(form.housingAllowance || 0),
      transportAllowance: Number(form.transportAllowance || 0),
    };
    if (editingId) {
      setEmployees((prev) => prev.map((e) => (e.id === editingId ? { ...e, ...cleaned } : e)));
    } else {
      setEmployees((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((e) => e.id)) + 1 : 1, ...cleaned, status: "active" }]);
    }
    resetForm();
  };

  const updateDoc = (idx, field, value) => setForm((f) => ({ ...f, documents: f.documents.map((d, i) => (i === idx ? { ...d, [field]: value } : d)) }));
  const addDoc = () => setForm((f) => ({ ...f, documents: [...f.documents, emptyDocRow()] }));
  const removeDoc = (idx) => setForm((f) => ({ ...f, documents: f.documents.filter((_, i) => i !== idx) }));

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل ملف الموظف — {form.name}</div>}
        <div className="form-grid">
          <label>الاسم<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="اسم الموظف" /></label>
          <label>المسمّى الوظيفي<input type="text" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder="مثال: محاسب" /></label>
          <label>القسم
            <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label>الشركة
            <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
              {COMPANIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>الجنسية
            <select value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })}>
              {NATIONALITIES.map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <label>تاريخ الميلاد<input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
          <label>تاريخ المباشرة<input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} /></label>
          <label>نوع العقد
            <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })}>
              <option value="unlimited">{CONTRACT_TYPES.unlimited}</option>
              <option value="limited">{CONTRACT_TYPES.limited}</option>
            </select>
          </label>
          {form.contractType === "limited" && (
            <label>نهاية العقد<input type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} /></label>
          )}
          <label>الأساسي<input type="number" value={form.basicSalary} onChange={(e) => setForm({ ...form, basicSalary: e.target.value })} placeholder="0" /></label>
          <label>بدل سكن<input type="number" value={form.housingAllowance} onChange={(e) => setForm({ ...form, housingAllowance: e.target.value })} placeholder="0" /></label>
          <label>بدل نقل<input type="number" value={form.transportAllowance} onChange={(e) => setForm({ ...form, transportAllowance: e.target.value })} placeholder="0" /></label>
          <label>اسم البنك<input type="text" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="مثال: الراجحي" /></label>
          <label>رقم الحساب / الآيبان<input type="text" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} placeholder="SA..." /></label>
          <label className="checkbox-field">
            <input type="checkbox" checked={form.gosiApplicable} onChange={(e) => setForm({ ...form, gosiApplicable: e.target.checked })} />
            خاضع للتأمينات الاجتماعية (GOSI)
          </label>
        </div>

        <h3 className="sub-head">المستندات والوثائق الرسمية</h3>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>نوع المستند</th><th>الرقم</th><th>تاريخ الانتهاء</th><th></th></tr></thead>
            <tbody>
              {form.documents.map((d, idx) => (
                <tr key={idx}>
                  <td><select value={d.type} onChange={(e) => updateDoc(idx, "type", e.target.value)}>{EMPLOYEE_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></td>
                  <td><input type="text" value={d.number} onChange={(e) => updateDoc(idx, "number", e.target.value)} /></td>
                  <td><input type="date" value={d.expiryDate} onChange={(e) => updateDoc(idx, "expiryDate", e.target.value)} /></td>
                  <td><button className="btn-remove-line" onClick={() => removeDoc(idx)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn-ghost" onClick={addDoc}>+ إضافة مستند</button>

        <div className="form-btn-group" style={{ marginTop: 14 }}>
          {editingId && <button className="btn-ghost" onClick={resetForm}>إلغاء التعديل</button>}
          <button className="btn-primary" onClick={saveEmployee}>{editingId ? "حفظ التعديلات" : "حفظ ملف الموظف"}</button>
        </div>
      </div>

      {list.length > 0 && (() => {
        const byDept = {};
        list.forEach((e) => { byDept[e.department] = (byDept[e.department] || 0) + 1; });
        const byContract = { unlimited: 0, limited: 0 };
        list.forEach((e) => { byContract[e.contractType] = (byContract[e.contractType] || 0) + 1; });
        const palette = ["#2F5D5A", "#B98B4E", "#3E6B8A", "#8A5A3E", "#A8432B", "#6B4E8A"];
        return (
          <div className="analytics-row">
            <MiniDonut title="الموظفون حسب القسم" segments={Object.entries(byDept).map(([label, value], i) => ({ label, value, color: palette[i % palette.length] }))} />
            <MiniBarChart title="الموظفون حسب نوع العقد" bars={[{ label: "غير محدد المدة", value: byContract.unlimited || 0, color: "#2F5D5A" }, { label: "محدد المدة", value: byContract.limited || 0, color: "#B98B4E" }]} valueFormatter={(v) => v} />
          </div>
        );
      })()}

      <div className="panel form-panel">
        <div className="filter-bar">
          <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="بحث بالاسم" />
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">كل الأقسام</option>
            {[...new Set(list.map((e) => e.department))].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <div className="hr-grid">
        {list.filter((emp) => (!searchText || emp.name.includes(searchText)) && (!deptFilter || emp.department === deptFilter)).map((emp) => {
          const docs = emp.documents || [];
          return (
            <div className="panel emp-card" key={emp.id}>
              <div className="emp-card-head">
                <div>
                  <div className="emp-name">{emp.name}</div>
                  <div className="emp-role">{emp.jobTitle} · {emp.department}</div>
                </div>
                <span className="status-badge">{emp.leaveStatus === "onLeave" ? "في إجازة" : (emp.status === "active" ? "على رأس العمل" : emp.status)}</span>
              </div>
              <div className="emp-meta-grid">
                <div><span>الشركة</span><strong>{COMPANIES.find((c) => c.id === emp.company)?.short}</strong></div>
                <div><span>الجنسية</span><strong>{emp.nationality || "—"}</strong></div>
                <div><span>تاريخ المباشرة</span><strong>{emp.hireDate}</strong></div>
                <div><span>الراتب الإجمالي</span><strong>{fmt(emp.basicSalary + emp.housingAllowance + emp.transportAllowance)} ر.س</strong></div>
              </div>
              {docs.length > 0 && (
                <div className="doc-chip-row">
                  {docs.map((d, i) => {
                    const days = d.expiryDate ? daysUntil(d.expiryDate) : null;
                    const cls = days == null ? "" : days < 0 ? "doc-expired" : days <= 30 ? "doc-warning" : "";
                    return (
                      <span key={i} className={"doc-chip " + cls}>
                        {d.type}{d.expiryDate ? ` — ${d.expiryDate}` : ""}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="entry-card-actions">
                <button className="btn-ghost" onClick={() => startEdit(emp)}>تعديل</button>
                <button className="btn-ghost" onClick={() => setPreviewEmp(emp)}>معاينة ملف المباشرة</button>
              </div>
            </div>
          );
        })}
        {list.length === 0 && <p className="empty">لا يوجد موظفون مسجّلون لهذا الكيان بعد.</p>}
      </div>

      {previewEmp && (
        <PrintShell
          subtitle="نموذج مباشرة عمل"
          refNode={<div>تاريخ الإصدار: <strong>2026-07-20</strong></div>}
          onClose={() => setPreviewEmp(null)}
          company={COMPANIES.find((c) => c.id === previewEmp.company)}
        >
          <div className="voucher-meta">
            <div><span>اسم الموظف</span><strong>{previewEmp.name}</strong></div>
            <div><span>الشركة</span><strong>{COMPANIES.find((c) => c.id === previewEmp.company)?.name}</strong></div>
            <div><span>المسمّى الوظيفي</span><strong>{previewEmp.jobTitle}</strong></div>
            <div><span>القسم</span><strong>{previewEmp.department}</strong></div>
            <div><span>تاريخ المباشرة الفعلي</span><strong>{previewEmp.hireDate}</strong></div>
            <div><span>نوع العقد</span><strong>{CONTRACT_TYPES[previewEmp.contractType]}</strong></div>
          </div>
          <p className="doc-paragraph">
            يُقر الموظف المذكور أعلاه بمباشرته العمل الفعلي لدى الشركة اعتباراً من التاريخ الموضح أعلاه، وذلك وفقاً لبنود
            وشروط العقد الموقّع بين الطرفين وأنظمة العمل السعودية المعمول بها.
          </p>
        </PrintShell>
      )}
    </div>
  );
}

export function LeavesModule({ employees, leaves, setLeaves, companyId }) {
  const companyEmployees = companyId === "all" ? employees : employees.filter((e) => e.company === companyId);
  const [form, setForm] = useState({ employeeId: companyEmployees[0]?.id || "", type: LEAVE_TYPES[0], startDate: "2026-07-25", endDate: "2026-08-01", note: "" });
  const [previewLeave, setPreviewLeave] = useState(null);

  const list = leaves.filter((l) => companyEmployees.some((e) => e.id === l.employeeId));

  const daysBetween = (s, e) => Math.max(Math.round((new Date(e) - new Date(s)) / 86400000) + 1, 0);

  const addLeave = () => {
    if (!form.employeeId) return;
    setLeaves((prev) => [
      ...prev,
      { id: prev.length ? Math.max(...prev.map((l) => l.id)) + 1 : 1, ...form, days: daysBetween(form.startDate, form.endDate), status: "معتمدة" },
    ]);
    setForm((f) => ({ ...f, note: "" }));
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الموظف
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: Number(e.target.value) })}>
              {companyEmployees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </label>
          <label>نوع الإجازة
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>من تاريخ<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
          <label>إلى تاريخ<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          <label className="memo-field">ملاحظات<input type="text" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="اختياري" /></label>
        </div>
        <button className="btn-primary" onClick={addLeave}>تسجيل الإجازة</button>
      </div>

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الموظف</th><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {list.slice().reverse().map((l) => {
              const emp = employees.find((e) => e.id === l.employeeId);
              return (
                <tr key={l.id}>
                  <td>{emp?.name}</td>
                  <td>{l.type}</td>
                  <td>{l.startDate}</td>
                  <td>{l.endDate}</td>
                  <td className="num">{l.days}</td>
                  <td><span className="status-badge">{l.status}</span></td>
                  <td><button className="btn-ghost" onClick={() => setPreviewLeave(l)}>إصدار خطاب</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="empty">لا توجد إجازات مسجّلة لهذا الكيان.</p>}
      </div>

      {previewLeave && (() => {
        const emp = employees.find((e) => e.id === previewLeave.employeeId);
        return (
          <PrintShell
            subtitle="خطاب إجازة"
            refNode={<div>رقم الطلب: <strong>{String(previewLeave.id).padStart(5, "0")}</strong></div>}
            onClose={() => setPreviewLeave(null)}
            company={COMPANIES.find((c) => c.id === emp?.company)}
          >
            <div className="voucher-meta">
              <div><span>اسم الموظف</span><strong>{emp?.name}</strong></div>
              <div><span>الشركة</span><strong>{COMPANIES.find((c) => c.id === emp?.company)?.name}</strong></div>
              <div><span>نوع الإجازة</span><strong>{previewLeave.type}</strong></div>
              <div><span>عدد الأيام</span><strong>{previewLeave.days} يوم</strong></div>
              <div><span>تاريخ البداية</span><strong>{previewLeave.startDate}</strong></div>
              <div><span>تاريخ العودة للعمل</span><strong>{previewLeave.endDate}</strong></div>
            </div>
            <p className="doc-paragraph">
              تُفيد الشركة بموافقتها على منح الموظف المذكور أعلاه إجازة {previewLeave.type} للمدة الموضحة، على أن يباشر
              عمله بعد انتهائها مباشرة. {previewLeave.note}
            </p>
          </PrintShell>
        );
      })()}
    </div>
  );
}

export function actionsForEmployeeMonth(hrActions, employeeId, month) {
  return hrActions.filter((a) => a.employeeId === employeeId && a.month === month);
}

export function summarizeActions(actions) {
  const s = { absenceDays: 0, overtime: 0, otherAdd: 0, advance: 0, violation: 0, penalty: 0, otherDed: 0 };
  actions.forEach((a) => {
    const v = Number(a.value || 0);
    if (a.actionType === "absence") s.absenceDays += v;
    else if (a.actionType === "overtime") s.overtime += v;
    else if (a.actionType === "bonus" || a.actionType === "other_addition") s.otherAdd += v;
    else if (a.actionType === "advance") s.advance += v;
    else if (a.actionType === "violation") s.violation += v;
    else if (a.actionType === "penalty") s.penalty += v;
    else if (a.actionType === "other_deduction") s.otherDed += v;
  });
  return s;
}

/* محرك الرواتب الموسّع: يدمج بيانات الموظف الثابتة مع إجراءات الشهر المحدد */
export function computeWidePayrollRow(emp, month, leaveSettlements, hrActions) {
  const empSettlements = leaveSettlements.filter((s) => s.employeeId === emp.id);
  const onLeaveThisMonth = empSettlements.find((s) => s.leaveStartDate.slice(0, 7) === month && !s.returnDate);
  const returningThisMonth = empSettlements.find((s) => s.returnDate && s.returnDate.slice(0, 7) === month);

  const blank = {
    basic: 0, housing: 0, transport: 0, otherAllow: 0, otherAdd: 0, overtime: 0,
    totalAdditions: 0, grossTotal: 0,
    gosi: 0, absence: 0, advance: 0, violation: 0, penalty: 0, otherDed: 0, totalDeductions: 0,
    net: 0, note: "", rowClass: "",
  };

  if (onLeaveThisMonth) {
    return { ...blank, note: "الموظف في إجازة — تمت تسوية مستحقاته بشكل منفصل", rowClass: "row-on-leave" };
  }

  const actions = actionsForEmployeeMonth(hrActions, emp.id, month);
  const a = summarizeActions(actions);

  let basic = emp.basicSalary, housing = emp.housingAllowance, transport = emp.transportAllowance, otherAllow = emp.otherAllowance || 0;
  let note = "", rowClass = "";

  if (returningThisMonth) {
    const dim = daysInMonth(month);
    const returnDay = Number(returningThisMonth.returnDate.slice(8, 10));
    const workedDays = Math.max(dim - returnDay + 1, 0);
    const factor = workedDays / dim;
    basic *= factor; housing *= factor; transport *= factor; otherAllow *= factor;
    note = `مباشرة بعد إجازة — ${workedDays} يوم من ${returningThisMonth.returnDate}`;
    rowClass = "row-partial";
  }

  const overtime = a.overtime;
  const otherAdd = a.otherAdd;
  const totalAdditions = housing + transport + otherAllow + otherAdd + overtime;
  const grossTotal = basic + totalAdditions;

  const gosi = emp.gosiAmount != null && emp.gosiAmount > 0 ? emp.gosiAmount : (emp.gosiApplicable ? Math.round((emp.basicSalary + emp.housingAllowance) * 0.0975) : 0);
  const absence = a.absenceDays * dailyRate(emp);
  const advance = (emp.advances || 0) + a.advance;
  const violation = a.violation;
  const penalty = a.penalty;
  const otherDed = (emp.otherDeductions || 0) + a.otherDed;
  const totalDeductions = gosi + absence + advance + violation + penalty + otherDed;
  const net = grossTotal - totalDeductions;

  return { basic, housing, transport, otherAllow, otherAdd, overtime, totalAdditions, grossTotal, gosi, absence, advance, violation, penalty, otherDed, totalDeductions, net, note, rowClass };
}

/* ============ إجراءات شئون الموظفين ============ */

export function ActionsModule({ employees, hrActions, setHrActions, companyId }) {
  const companyEmployees = companyId === "all" ? employees : employees.filter((e) => e.company === companyId);
  const [actionType, setActionType] = useState(ACTION_TYPES[0].id);
  const [month, setMonth] = useState("2026-07");
  const [scope, setScope] = useState("single");
  const [employeeId, setEmployeeId] = useState(companyEmployees[0]?.id || "");
  const [selectedIds, setSelectedIds] = useState([]);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  const actionDef = ACTION_TYPE_MAP[actionType];
  const list = hrActions.filter((a) => companyEmployees.some((e) => e.id === a.employeeId) && a.month === month);

  const toggleSelected = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const targetIds = scope === "all" ? companyEmployees.map((e) => e.id) : scope === "some" ? selectedIds : (employeeId ? [employeeId] : []);

  const save = () => {
    if (targetIds.length === 0) return;
    if (actionDef.unit !== "none" && (!value || Number(value) <= 0)) return;
    const batchId = Date.now();
    setHrActions((prev) => {
      let nextId = prev.length ? Math.max(...prev.map((a) => a.id)) + 1 : 1;
      const newOnes = targetIds.map((empId) => ({ id: nextId++, employeeId: empId, month, actionType, value: Number(value || 0), note, batchId }));
      return [...prev, ...newOnes];
    });
    setValue(""); setNote("");
  };

  const removeAction = (id) => setHrActions((prev) => prev.filter((a) => a.id !== id));

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>نوع الإجراء
            <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
              {ACTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label>شهر الرواتب<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          {actionDef.unit !== "none" && (
            <label>{actionDef.unit === "days" ? "عدد الأيام" : "القيمة (ر.س)"}<input type="number" value={value} onChange={(e) => setValue(e.target.value)} /></label>
          )}
          <label className="memo-field">ملاحظة<input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="اختياري" /></label>
        </div>

        <div className="scope-row">
          <label className="scope-option"><input type="radio" checked={scope === "single"} onChange={() => setScope("single")} /> موظف واحد</label>
          <label className="scope-option"><input type="radio" checked={scope === "some"} onChange={() => setScope("some")} /> مجموعة محددة</label>
          <label className="scope-option"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> كل الموظفين</label>
        </div>

        {scope === "single" && (
          <div className="form-grid">
            <label>الموظف<select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>{companyEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          </div>
        )}
        {scope === "some" && (
          <div className="employee-checklist">
            {companyEmployees.map((e) => (
              <label key={e.id} className="checkbox-field">
                <input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleSelected(e.id)} /> {e.name}
              </label>
            ))}
          </div>
        )}
        {scope === "all" && <p className="note">سيُطبَّق هذا الإجراء على كل موظفي هذا الكيان ({companyEmployees.length} موظف).</p>}

        <button className="btn-primary" onClick={save} disabled={targetIds.length === 0}>حفظ الإجراء ({targetIds.length} موظف)</button>
      </div>

      <div className="panel">
        <h3>إجراءات شهر {monthLabel(month)}</h3>
        <table className="ledger-table">
          <thead><tr><th>الموظف</th><th>الإجراء</th><th>القيمة</th><th>ملاحظة</th><th></th></tr></thead>
          <tbody>
            {list.slice().reverse().map((a) => {
              const emp = employees.find((e) => e.id === a.employeeId);
              const def = ACTION_TYPE_MAP[a.actionType];
              return (
                <tr key={a.id}>
                  <td>{emp?.name}</td>
                  <td>{def?.label}</td>
                  <td className="num">{def?.unit === "none" ? "—" : def?.unit === "days" ? `${a.value} يوم` : fmt(a.value)}</td>
                  <td>{a.note || "—"}</td>
                  <td><button className="btn-ghost" onClick={() => removeAction(a.id)}>حذف</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="empty">لا توجد إجراءات مسجّلة لهذا الشهر بعد.</p>}
      </div>
    </div>
  );
}

/* ============ كشف الرواتب الاحترافي (بالعرض) مع الترحيل وفك الترحيل ============ */

export const PAYROLL_JOURNAL_MAP = [
  ["basic", "مصروف رواتب أساسية", "debit"],
  ["housing", "مصروف بدل سكن", "debit"],
  ["transport", "مصروف بدل مواصلات", "debit"],
  ["otherAllow", "مصروف بدلات أخرى", "debit"],
  ["otherAdd", "مصروف إضافات وحوافز أخرى", "debit"],
  ["overtime", "مصروف بدل إضافي (عمل إضافي)", "debit"],
  ["gosi", "التأمينات الاجتماعية - مستحقة", "credit"],
  ["advance", "سلف الموظفين", "credit"],
  ["violation", "صندوق العاملين - مخالفات وعقوبات", "credit"],
  ["penalty", "صندوق العاملين - مخالفات وعقوبات", "credit"],
  ["otherDed", "استقطاعات أخرى مستحقة", "credit"],
];

export const PAYROLL_ROW_FIELDS = [
  ["basic", "الأساسي"], ["housing", "بدل سكن"], ["transport", "بدل مواصلات"], ["otherAllow", "بدلات أخرى"],
  ["otherAdd", "إضافات أخرى"], ["overtime", "بدل إضافي"], ["gosi", "تأمينات"], ["absence", "غياب"],
  ["advance", "سلف"], ["violation", "مخالفات"], ["penalty", "عقوبات"], ["otherDed", "خصومات أخرى"],
];

export function applyRowOverride(row, override) {
  if (!override) return row;
  const merged = { ...row, ...override };
  merged.totalAdditions = merged.housing + merged.transport + merged.otherAllow + merged.otherAdd + merged.overtime;
  merged.grossTotal = merged.basic + merged.totalAdditions;
  merged.totalDeductions = merged.gosi + merged.absence + merged.advance + merged.violation + merged.penalty + merged.otherDed;
  merged.net = merged.grossTotal - merged.totalDeductions;
  return merged;
}

export function PayrollModule({ employees, companyId, leaveSettlements, hrActions, payrollRuns, setPayrollRuns, entries, setEntries, unlockPin }) {
  const [month, setMonth] = useState("2026-07");
  const [scope, setScope] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [addEmpId, setAddEmpId] = useState("");
  const [showSheet, setShowSheet] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [editingRowId, setEditingRowId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const companyEmployees = companyId === "all" ? employees : employees.filter((e) => e.company === companyId);
  const existingRun = companyId !== "all" ? payrollRuns.find((r) => r.company === companyId && r.month === month) : null;

  const createRun = () => {
    if (companyId === "all") return;
    const ids = scope === "all" ? companyEmployees.map((e) => e.id) : selectedIds;
    if (ids.length === 0) return;
    setPayrollRuns((prev) => [...prev, { id: prev.length ? Math.max(...prev.map((r) => r.id)) + 1 : 1, company: companyId, month, employeeIds: ids, status: "draft", journalEntryId: null, overrides: {} }]);
  };

  const addEmployeeToRun = () => {
    if (!addEmpId || !existingRun) return;
    setPayrollRuns((prev) => prev.map((r) => (r.id === existingRun.id ? { ...r, employeeIds: [...r.employeeIds, Number(addEmpId)] } : r)));
    setAddEmpId("");
  };
  const removeEmployeeFromRun = (empId) => {
    if (!existingRun) return;
    setPayrollRuns((prev) => prev.map((r) => (r.id === existingRun.id ? { ...r, employeeIds: r.employeeIds.filter((id) => id !== empId) } : r)));
  };

  const startEditRow = (emp, computedRow) => {
    setEditingRowId(emp.id);
    const existingOverride = existingRun?.overrides?.[emp.id];
    setEditForm(existingOverride ? { ...computedRow, ...existingOverride } : { ...computedRow });
  };
  const saveRowEdit = () => {
    if (!existingRun || editingRowId == null) return;
    const overrideValues = {};
    PAYROLL_ROW_FIELDS.forEach(([field]) => { overrideValues[field] = Number(editForm[field] || 0); });
    setPayrollRuns((prev) => prev.map((r) => (r.id === existingRun.id ? { ...r, overrides: { ...(r.overrides || {}), [editingRowId]: overrideValues } } : r)));
    setEditingRowId(null); setEditForm(null);
  };
  const clearRowOverride = (empId) => {
    if (!existingRun) return;
    setPayrollRuns((prev) => prev.map((r) => {
      if (r.id !== existingRun.id) return r;
      const overrides = { ...(r.overrides || {}) };
      delete overrides[empId];
      return { ...r, overrides };
    }));
  };

  const runRows = existingRun
    ? existingRun.employeeIds.map((id) => {
        const emp = employees.find((e) => e.id === id);
        const base = { emp, ...computeWidePayrollRow(emp, month, leaveSettlements, hrActions) };
        const override = existingRun.overrides?.[id];
        return override ? { ...base, ...applyRowOverride(base, override), overridden: true } : base;
      })
    : [];
  const totals = runRows.reduce((s, r) => {
    Object.keys(s).forEach((k) => { s[k] += r[k] || 0; });
    return s;
  }, { basic: 0, housing: 0, transport: 0, otherAllow: 0, otherAdd: 0, overtime: 0, totalAdditions: 0, grossTotal: 0, gosi: 0, absence: 0, advance: 0, violation: 0, penalty: 0, otherDed: 0, totalDeductions: 0, net: 0 });

  const postRun = () => {
    if (!existingRun || runRows.length === 0) return;
    const byAccount = {};
    runRows.forEach((r) => {
      PAYROLL_JOURNAL_MAP.forEach(([field, account]) => {
        const amt = r[field] || 0;
        if (amt > 0) byAccount[account] = (byAccount[account] || 0) + amt;
      });
    });
    const jLines = [];
    PAYROLL_JOURNAL_MAP.filter(([, , side]) => side === "debit").forEach(([, account]) => {
      if (byAccount[account]) jLines.push({ account, costCenter: "", department: "المالية والحسابات", debit: byAccount[account], credit: 0 });
    });
    const totalCredits = PAYROLL_JOURNAL_MAP.filter(([, , side]) => side === "credit").reduce((s, [, account]) => s + (byAccount[account] || 0), 0);
    PAYROLL_JOURNAL_MAP.filter(([, , side]) => side === "credit").forEach(([, account]) => {
      if (byAccount[account] && !jLines.some((l) => l.account === account && l.credit === byAccount[account])) {
        jLines.push({ account, costCenter: "", department: "المالية والحسابات", debit: 0, credit: byAccount[account] });
      }
    });
    const netPayable = totals.net;
    jLines.push({ account: "رواتب مستحقة للصرف", costCenter: "", department: "المالية والحسابات", debit: 0, credit: netPayable });

    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: companyId, date: `${month}-28`, memo: `كشف رواتب ${monthLabel(month)} — ${runRows.length} موظف`, lines: jLines }]);
    setPayrollRuns((prev) => prev.map((r) => (r.id === existingRun.id ? { ...r, status: "posted", journalEntryId: entryId } : r)));
  };

  const unpostRun = () => {
    if (pinInput !== unlockPin) { setPinError(true); return; }
    setPinError(false); setPinInput("");
    setEntries((prev) => prev.filter((e) => e.id !== existingRun.journalEntryId));
    setPayrollRuns((prev) => prev.map((r) => (r.id === existingRun.id ? { ...r, status: "draft", journalEntryId: null } : r)));
  };

  const availableToAdd = companyEmployees.filter((e) => existingRun && !existingRun.employeeIds.includes(e.id));
  const isPosted = existingRun?.status === "posted";
  const printCompany = COMPANIES.find((c) => c.id === companyId);

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>شهر الرواتب<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        </div>
        {companyId === "all" ? (
          <p className="empty">اختر شركة محددة من أيقونات لوحة القيادة أولاً لإنشاء أو عرض كشف رواتبها.</p>
        ) : !existingRun ? (
          <>
            <div className="scope-row">
              <label className="scope-option"><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> كل الموظفين ({companyEmployees.length})</label>
              <label className="scope-option"><input type="radio" checked={scope === "some"} onChange={() => setScope("some")} /> تحديد موظفين</label>
            </div>
            {scope === "some" && (
              <div className="employee-checklist">
                {companyEmployees.map((e) => (
                  <label key={e.id} className="checkbox-field">
                    <input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => setSelectedIds((prev) => (prev.includes(e.id) ? prev.filter((x) => x !== e.id) : [...prev, e.id]))} /> {e.name}
                  </label>
                ))}
              </div>
            )}
            <button className="btn-primary" onClick={createRun}>إنشاء كشف رواتب لشهر {monthLabel(month)}</button>
          </>
        ) : (
          <div className="run-status-bar">
            <span className={"status-badge" + (isPosted ? " posted-badge" : "")}>{isPosted ? "مرحّل ✓" : "مسودة — غير مرحّل"}</span>
            {!isPosted && (
              <span className="add-emp-inline">
                <select value={addEmpId} onChange={(e) => setAddEmpId(e.target.value)}>
                  <option value="">— إضافة موظف للكشف —</option>
                  {availableToAdd.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <button className="btn-ghost" onClick={addEmployeeToRun} disabled={!addEmpId}>إضافة</button>
              </span>
            )}
            <span className="run-actions">
              <button className="btn-ghost" onClick={() => setShowSheet(true)}>معاينة / طباعة</button>
              {!isPosted && <button className="btn-primary" onClick={postRun}>ترحيل الكشف</button>}
              {isPosted && (
                <span className="unlock-inline">
                  <input type="password" placeholder="الرقم السري لفك الترحيل" value={pinInput} onChange={(e) => { setPinInput(e.target.value); setPinError(false); }} />
                  <button className="btn-ghost" onClick={unpostRun}>فك الترحيل</button>
                </span>
              )}
            </span>
            {pinError && <span className="balance-bad">رقم سري غير صحيح.</span>}
          </div>
        )}
      </div>

      {existingRun && (
        <div className="panel wide-table-wrap">
          <table className="ledger-table wide-payroll-table">
            <thead>
              <tr>
                <th rowSpan={2}>م</th><th rowSpan={2}>الموظف</th><th rowSpan={2}>الوظيفة</th>
                <th colSpan={7} className="group-head">الإضافات</th>
                <th rowSpan={2}>إجمالي الراتب</th>
                <th colSpan={6} className="group-head">الخصومات</th>
                <th rowSpan={2}>صافي الراتب</th>
                {!isPosted && <th rowSpan={2}></th>}
              </tr>
              <tr>
                <th>الأساسي</th><th>سكن</th><th>مواصلات</th><th>بدلات أخرى</th><th>إضافات أخرى</th><th>بدل إضافي</th><th>إجمالي الإضافات</th>
                <th>تأمينات</th><th>غياب</th><th>سلف</th><th>مخالفات</th><th>عقوبات</th><th>خصومات أخرى</th>
              </tr>
            </thead>
            <tbody>
              {runRows.map((r, i) => (
                <tr key={r.emp.id} className={r.rowClass}>
                  <td>{i + 1}</td><td>{r.emp.name}{r.overridden && <span className="override-mark" title="تم تعديل هذا الصف يدوياً"> ✎</span>}</td><td>{r.emp.jobTitle}</td>
                  <td className="num">{fmt(r.basic)}</td><td className="num">{fmt(r.housing)}</td><td className="num">{fmt(r.transport)}</td>
                  <td className="num">{fmt(r.otherAllow)}</td><td className="num">{fmt(r.otherAdd)}</td><td className="num">{fmt(r.overtime)}</td>
                  <td className="num strong">{fmt(r.totalAdditions)}</td>
                  <td className="num strong">{fmt(r.grossTotal)}</td>
                  <td className="num">{fmt(r.gosi)}</td><td className="num">{fmt(r.absence)}</td><td className="num">{fmt(r.advance)}</td>
                  <td className="num">{fmt(r.violation)}</td><td className="num">{fmt(r.penalty)}</td><td className="num">{fmt(r.otherDed)}</td>
                  <td className="num strong">{fmt(r.net)}</td>
                  {!isPosted && (
                    <td className="row-actions-cell">
                      <button className="btn-ghost btn-tiny" onClick={() => startEditRow(r.emp, r)}>تعديل</button>
                      {r.overridden && <button className="btn-ghost btn-tiny" onClick={() => clearRowOverride(r.emp.id)}>استرجاع</button>}
                      <button className="btn-remove-line" onClick={() => removeEmployeeFromRun(r.emp.id)}>✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="foot-label" colSpan={3}>الإجمالي</td>
                <td className="num strong">{fmt(totals.basic)}</td><td className="num strong">{fmt(totals.housing)}</td><td className="num strong">{fmt(totals.transport)}</td>
                <td className="num strong">{fmt(totals.otherAllow)}</td><td className="num strong">{fmt(totals.otherAdd)}</td><td className="num strong">{fmt(totals.overtime)}</td>
                <td className="num strong">{fmt(totals.totalAdditions)}</td><td className="num strong">{fmt(totals.grossTotal)}</td>
                <td className="num strong">{fmt(totals.gosi)}</td><td className="num strong">{fmt(totals.absence)}</td><td className="num strong">{fmt(totals.advance)}</td>
                <td className="num strong">{fmt(totals.violation)}</td><td className="num strong">{fmt(totals.penalty)}</td><td className="num strong">{fmt(totals.otherDed)}</td>
                <td className="num strong">{fmt(totals.net)}</td>
                {!isPosted && <td></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {editingRowId != null && editForm && (
        <div className="panel form-panel row-edit-panel">
          <h3>تعديل بيانات: {employees.find((e) => e.id === editingRowId)?.name}</h3>
          <div className="form-grid">
            {PAYROLL_ROW_FIELDS.map(([field, label]) => (
              <label key={field}>{label}<input type="number" value={editForm[field]} onChange={(e) => setEditForm({ ...editForm, [field]: e.target.value })} /></label>
            ))}
          </div>
          <div className="form-btn-group">
            <button className="btn-ghost" onClick={() => { setEditingRowId(null); setEditForm(null); }}>إلغاء</button>
            <button className="btn-primary" onClick={saveRowEdit}>حفظ تعديل الصف</button>
          </div>
        </div>
      )}

      {!existingRun && companyId !== "all" && <p className="empty">لا يوجد كشف رواتب لهذا الشهر بعد — أنشئ واحداً أعلاه.</p>}

      {showSheet && existingRun && (
        <PrintShell subtitle={`كشف رواتب — ${monthLabel(month)}`} company={printCompany} refNode={<div>عدد الموظفين: <strong>{runRows.length}</strong></div>} onClose={() => setShowSheet(false)} showSignatures={true} landscape={true}>
          <div className="wide-table-wrap">
            <table className="ledger-table wide-payroll-table voucher-table">
              <thead>
                <tr>
                  <th>م</th><th>الموظف</th><th>الوظيفة</th>
                  <th>الأساسي</th><th>سكن</th><th>مواصلات</th><th>بدلات أخرى</th><th>إضافات أخرى</th><th>بدل إضافي</th><th>إجمالي الإضافات</th><th>إجمالي الراتب</th>
                  <th>تأمينات</th><th>غياب</th><th>سلف</th><th>مخالفات</th><th>عقوبات</th><th>خصومات أخرى</th><th>صافي الراتب</th>
                </tr>
              </thead>
              <tbody>
                {runRows.map((r, i) => (
                  <tr key={r.emp.id}>
                    <td>{i + 1}</td><td>{r.emp.name}</td><td>{r.emp.jobTitle}</td>
                    <td className="num">{fmt(r.basic)}</td><td className="num">{fmt(r.housing)}</td><td className="num">{fmt(r.transport)}</td>
                    <td className="num">{fmt(r.otherAllow)}</td><td className="num">{fmt(r.otherAdd)}</td><td className="num">{fmt(r.overtime)}</td>
                    <td className="num strong">{fmt(r.totalAdditions)}</td><td className="num strong">{fmt(r.grossTotal)}</td>
                    <td className="num">{fmt(r.gosi)}</td><td className="num">{fmt(r.absence)}</td><td className="num">{fmt(r.advance)}</td>
                    <td className="num">{fmt(r.violation)}</td><td className="num">{fmt(r.penalty)}</td><td className="num">{fmt(r.otherDed)}</td>
                    <td className="num strong">{fmt(r.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="foot-label" colSpan={3}>الإجمالي</td>
                  <td className="num strong">{fmt(totals.basic)}</td><td className="num strong">{fmt(totals.housing)}</td><td className="num strong">{fmt(totals.transport)}</td>
                  <td className="num strong">{fmt(totals.otherAllow)}</td><td className="num strong">{fmt(totals.otherAdd)}</td><td className="num strong">{fmt(totals.overtime)}</td>
                  <td className="num strong">{fmt(totals.totalAdditions)}</td><td className="num strong">{fmt(totals.grossTotal)}</td>
                  <td className="num strong">{fmt(totals.gosi)}</td><td className="num strong">{fmt(totals.absence)}</td><td className="num strong">{fmt(totals.advance)}</td>
                  <td className="num strong">{fmt(totals.violation)}</td><td className="num strong">{fmt(totals.penalty)}</td><td className="num strong">{fmt(totals.otherDed)}</td>
                  <td className="num strong">{fmt(totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </PrintShell>
      )}
    </div>
  );
}

export function EndOfServiceModule({ employees, companyId }) {
  const companyEmployees = companyId === "all" ? employees : employees.filter((e) => e.company === companyId);
  const [employeeId, setEmployeeId] = useState(companyEmployees[0]?.id || "");
  const [endDate, setEndDate] = useState("2026-07-20");
  const [reason, setReason] = useState("resign");
  const [showLetter, setShowLetter] = useState(false);

  const emp = employees.find((e) => e.id === employeeId);
  const calc = emp ? calcEOS(emp, endDate, reason) : null;
  const dur = emp ? serviceDuration(emp.hireDate, endDate) : null;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الموظف
            <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
              {companyEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>تاريخ انتهاء الخدمة<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label>سبب الانتهاء
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {TERMINATION_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {emp && calc && (
        <div className="panel">
          <h3>حساب مكافأة نهاية الخدمة (تقديري)</h3>
          <table className="ledger-table">
            <tbody>
              <tr><td>مدة الخدمة</td><td className="num">{dur.years} سنة و{dur.months} شهر و{dur.days} يوم</td></tr>
              <tr><td>الأجر المحتسب عليه (أساسي + سكن)</td><td className="num">{fmt(calc.wage)} ر.س</td></tr>
              <tr><td>المكافأة الكاملة قبل التخفيض</td><td className="num">{fmt(calc.fullReward)} ر.س</td></tr>
              <tr><td>نسبة الاستحقاق المطبّقة</td><td className="num">{calc.ratioNote}</td></tr>
              <tr className="net-row"><td className="strong">صافي مكافأة نهاية الخدمة المستحقة</td><td className="num strong">{fmt(calc.finalAmount)} ر.س</td></tr>
            </tbody>
          </table>
          <p className="note">
            الحساب مبني على المادتين 84 و85 من نظام العمل السعودي بصورة مبسّطة توضيحية (نصف شهر عن كل سنة من أول خمس سنوات
            وشهر كامل عمّا زاد)، ولا يُغني عن المراجعة القانونية الدقيقة لكل حالة.
          </p>
          <button className="btn-primary" onClick={() => setShowLetter(true)}>إصدار إخطار نهاية الخدمة</button>
        </div>
      )}

      {showLetter && emp && calc && (
        <PrintShell
          subtitle="إخطار مكافأة نهاية الخدمة"
          refNode={<div>تاريخ الإصدار: <strong>{endDate}</strong></div>}
          onClose={() => setShowLetter(false)}
          company={COMPANIES.find((c) => c.id === emp.company)}
        >
          <div className="voucher-meta">
            <div><span>اسم الموظف</span><strong>{emp.name}</strong></div>
            <div><span>الشركة</span><strong>{COMPANIES.find((c) => c.id === emp.company)?.name}</strong></div>
            <div><span>تاريخ المباشرة</span><strong>{emp.hireDate}</strong></div>
            <div><span>تاريخ انتهاء الخدمة</span><strong>{endDate}</strong></div>
            <div><span>سبب الانتهاء</span><strong>{TERMINATION_REASONS.find((r) => r.id === reason)?.label}</strong></div>
            <div><span>مدة الخدمة</span><strong>{dur.years} سنة و{dur.months} شهر</strong></div>
          </div>
          <table className="ledger-table voucher-table">
            <tbody>
              <tr><td>المكافأة الكاملة قبل التخفيض</td><td className="num">{fmt(calc.fullReward)} ر.س</td></tr>
              <tr><td>نسبة الاستحقاق</td><td className="num">{calc.ratioNote}</td></tr>
              <tr className="net-row"><td className="strong">الصافي المستحق</td><td className="num strong">{fmt(calc.finalAmount)} ر.س</td></tr>
            </tbody>
          </table>
        </PrintShell>
      )}
    </div>
  );
}

export function LeaveSettlementModule({ employees, setEmployees, entries, setEntries, leaveSettlements, setLeaveSettlements, companyId }) {
  const companyEmployees = companyId === "all" ? employees : employees.filter((e) => e.company === companyId);
  const availableEmployees = companyEmployees.filter((e) => e.leaveStatus !== "onLeave");
  const [employeeId, setEmployeeId] = useState(availableEmployees[0]?.id || "");
  const [leaveStartDate, setLeaveStartDate] = useState("2026-07-20");
  const [bonuses, setBonuses] = useState("");
  const [deductions, setDeductions] = useState("");
  const [ticketAmount, setTicketAmount] = useState("");
  const [visaAmount, setVisaAmount] = useState("");
  const [disbursingId, setDisbursingId] = useState(null);
  const [disbMethod, setDisbMethod] = useState("cash");
  const [disbDate, setDisbDate] = useState("2026-07-20");
  const [previewSettlement, setPreviewSettlement] = useState(null);

  const emp = employees.find((e) => e.id === employeeId);
  const list = leaveSettlements.filter((s) => companyEmployees.some((e) => e.id === s.employeeId));

  let preview = null;
  if (emp) {
    const daysWorked = new Date(leaveStartDate).getDate();
    const daily = dailyRate(emp);
    const monthAmount = daily * daysWorked;
    const bon = Number(bonuses || 0), ded = Number(deductions || 0), tic = Number(ticketAmount || 0), vis = Number(visaAmount || 0);
    const net = monthAmount + bon - ded + tic + vis;
    const accrual = accruedLeaveDays(emp, leaveStartDate);
    preview = { daysWorked, daily, monthAmount, bon, ded, tic, vis, net, accrual };
  }

  const saveSettlement = () => {
    if (!emp || !preview || preview.net <= 0) return;
    const salaryPortion = preview.monthAmount + preview.bon - preview.ded;
    const ticketVisaPortion = preview.tic + preview.vis;
    const lines = [];
    if (salaryPortion !== 0) {
      lines.push({ account: "مصروف رواتب", costCenter: "", department: "المالية والحسابات", debit: Math.max(salaryPortion, 0), credit: 0, employeeId: emp.id });
    }
    if (ticketVisaPortion > 0) {
      lines.push({ account: "مصروف تذاكر وتأشيرات الموظفين", costCenter: "", department: "الموارد البشرية", debit: ticketVisaPortion, credit: 0, employeeId: emp.id });
    }
    lines.push({ account: "ذمم الموظفين - مستحقات وإجازات", costCenter: "", department: "المالية والحسابات", debit: 0, credit: preview.net, employeeId: emp.id });

    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: emp.company, date: leaveStartDate, memo: `مستحقات إجازة — ${emp.name}`, lines }]);

    setLeaveSettlements((prev) => [
      ...prev,
      {
        id: prev.length ? Math.max(...prev.map((s) => s.id)) + 1 : 1,
        employeeId: emp.id, leaveStartDate,
        monthAmount: preview.monthAmount, daysWorked: preview.daysWorked,
        bonuses: preview.bon, deductions: preview.ded, ticketAmount: preview.tic, visaAmount: preview.vis,
        accruedDays: preview.accrual.days, netAmount: preview.net,
        journalEntryId: entryId, status: "محتسبة", disbursement: null, returnDate: null,
      },
    ]);
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, leaveStatus: "onLeave" } : e)));
    setBonuses(""); setDeductions(""); setTicketAmount(""); setVisaAmount("");
  };

  const confirmDisbursement = (settlement) => {
    const targetEmp = employees.find((e) => e.id === settlement.employeeId);
    if (!targetEmp) return;
    const creditAccount = disbMethod === "cash" ? "النقدية بالصندوق" : "البنك الأهلي - حساب تشغيلي";
    const lines = [
      { account: "ذمم الموظفين - مستحقات وإجازات", costCenter: "", department: "المالية والحسابات", debit: settlement.netAmount, credit: 0, employeeId: targetEmp.id },
      { account: creditAccount, costCenter: "", department: "المالية والحسابات", debit: 0, credit: settlement.netAmount, employeeId: targetEmp.id },
    ];
    const entryId = entries.length ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
    setEntries((prev) => [...prev, { id: entryId, company: targetEmp.company, date: disbDate, memo: `صرف مستحقات إجازة — ${targetEmp.name}`, lines }]);
    setLeaveSettlements((prev) => prev.map((s) => (s.id === settlement.id ? { ...s, status: "مصروفة", disbursement: { method: disbMethod, date: disbDate, journalEntryId: entryId } } : s)));
    setDisbursingId(null);
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الموظف
            <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
              {availableEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>تاريخ بداية الإجازة<input type="date" value={leaveStartDate} onChange={(e) => setLeaveStartDate(e.target.value)} /></label>
          <label>إضافات / مكافآت<input type="number" value={bonuses} onChange={(e) => setBonuses(e.target.value)} placeholder="0" /></label>
          <label>خصومات<input type="number" value={deductions} onChange={(e) => setDeductions(e.target.value)} placeholder="0" /></label>
          <label>تذكرة السفر<input type="number" value={ticketAmount} onChange={(e) => setTicketAmount(e.target.value)} placeholder="0" /></label>
          <label>تأشيرة خروج وعودة<input type="number" value={visaAmount} onChange={(e) => setVisaAmount(e.target.value)} placeholder="0" /></label>
        </div>

        {emp && preview && (
          <div className="preview-box">
            <div className="preview-row"><span>أيام العمل المستحقة من الشهر</span><strong>{preview.daysWorked} يوم</strong></div>
            <div className="preview-row"><span>راتب أيام الشهر قبل الإجازة</span><strong>{fmt(preview.monthAmount)} ر.س</strong></div>
            <div className="preview-row"><span>رصيد الإجازة المتراكم (منذ {preview.accrual.refDate})</span><strong>{preview.accrual.days.toFixed(1)} يوم</strong></div>
            <div className="preview-row"><span>الإضافات</span><strong>{fmt(preview.bon)} ر.س</strong></div>
            <div className="preview-row"><span>الخصومات</span><strong>-{fmt(preview.ded)} ر.س</strong></div>
            <div className="preview-row"><span>تذكرة السفر + التأشيرة</span><strong>{fmt(preview.tic + preview.vis)} ر.س</strong></div>
            <div className="preview-row net-row"><span>صافي المبلغ المستحق</span><strong>{fmt(preview.net)} ر.س</strong></div>
          </div>
        )}

        <button className="btn-primary" onClick={saveSettlement} disabled={!emp || !preview || preview.net <= 0}>
          حفظ واعتماد المستحقات (يرحّل قيداً تلقائياً)
        </button>
        {availableEmployees.length === 0 && <p className="empty">كل موظفي هذا الكيان في إجازة حالياً.</p>}
      </div>

      <div className="panel">
        <table className="ledger-table">
          <thead><tr><th>الموظف</th><th>بداية الإجازة</th><th>الصافي</th><th>الحالة</th><th>رصيد الحساب</th><th></th></tr></thead>
          <tbody>
            {list.slice().reverse().map((s) => {
              const e = employees.find((x) => x.id === s.employeeId);
              const balance = employeeAccountBalance(entries, s.employeeId);
              return (
                <tr key={s.id}>
                  <td>{e?.name}</td>
                  <td>{s.leaveStartDate}</td>
                  <td className="num">{fmt(s.netAmount)}</td>
                  <td><span className="status-badge">{s.status}</span></td>
                  <td className="num">{fmt(balance)}</td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => setPreviewSettlement(s)}>معاينة</button>
                    {s.status === "محتسبة" && (
                      disbursingId === s.id ? (
                        <span className="inline-disb">
                          <select value={disbMethod} onChange={(e2) => setDisbMethod(e2.target.value)}>
                            <option value="cash">كاش</option>
                            <option value="bank">بنك</option>
                          </select>
                          <input type="date" value={disbDate} onChange={(e2) => setDisbDate(e2.target.value)} />
                          <button className="btn-primary" onClick={() => confirmDisbursement(s)}>تأكيد الصرف</button>
                        </span>
                      ) : (
                        <button className="btn-ghost" onClick={() => { setDisbursingId(s.id); setDisbDate(s.leaveStartDate); }}>صرف الدفعة</button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="empty">لا توجد تسويات إجازات مسجّلة بعد.</p>}
      </div>

      {previewSettlement && (() => {
        const e = employees.find((x) => x.id === previewSettlement.employeeId);
        return (
          <PrintShell
            subtitle="تسوية مستحقات إجازة"
            refNode={<div>رقم التسوية: <strong>{String(previewSettlement.id).padStart(5, "0")}</strong></div>}
            onClose={() => setPreviewSettlement(null)}
            company={COMPANIES.find((c) => c.id === e?.company)}
          >
            <div className="voucher-meta">
              <div><span>اسم الموظف</span><strong>{e?.name}</strong></div>
              <div><span>الشركة</span><strong>{COMPANIES.find((c) => c.id === e?.company)?.name}</strong></div>
              <div><span>تاريخ بداية الإجازة</span><strong>{previewSettlement.leaveStartDate}</strong></div>
              <div><span>الحالة</span><strong>{previewSettlement.status}</strong></div>
            </div>
            <table className="ledger-table voucher-table">
              <tbody>
                <tr><td>راتب {previewSettlement.daysWorked} يوم من الشهر</td><td className="num">{fmt(previewSettlement.monthAmount)}</td></tr>
                <tr><td>إضافات</td><td className="num">{fmt(previewSettlement.bonuses)}</td></tr>
                <tr><td>خصومات</td><td className="num">-{fmt(previewSettlement.deductions)}</td></tr>
                <tr><td>تذكرة سفر</td><td className="num">{fmt(previewSettlement.ticketAmount)}</td></tr>
                <tr><td>تأشيرة خروج وعودة</td><td className="num">{fmt(previewSettlement.visaAmount)}</td></tr>
                <tr className="net-row"><td className="strong">صافي المستحق</td><td className="num strong">{fmt(previewSettlement.netAmount)}</td></tr>
              </tbody>
            </table>
          </PrintShell>
        );
      })()}
    </div>
  );
}

export function LeaveReturnModule({ employees, setEmployees, leaveSettlements, setLeaveSettlements, companyId }) {
  const onLeaveEmployees = employees.filter((e) => e.leaveStatus === "onLeave" && (companyId === "all" || e.company === companyId));
  const [employeeId, setEmployeeId] = useState(onLeaveEmployees[0]?.id || "");
  const [returnDate, setReturnDate] = useState("2026-08-20");

  const emp = employees.find((e) => e.id === employeeId);
  const openSettlement = emp ? leaveSettlements.find((s) => s.employeeId === emp.id && !s.returnDate) : null;

  let preview = null;
  if (emp) {
    const month = returnDate.slice(0, 7);
    const dim = daysInMonth(month);
    const workedDays = Math.max(dim - new Date(returnDate).getDate() + 1, 0);
    const amount = dailyRate(emp) * workedDays;
    preview = { month, dim, workedDays, amount };
  }

  const registerReturn = () => {
    if (!emp || !openSettlement) return;
    setLeaveSettlements((prev) => prev.map((s) => (s.id === openSettlement.id ? { ...s, returnDate } : s)));
    setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, leaveStatus: "active", lastLeaveReturnDate: returnDate } : e)));
  };

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>الموظف (في إجازة حالياً)
            <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
              {onLeaveEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>تاريخ المباشرة بعد الإجازة<input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></label>
        </div>

        {onLeaveEmployees.length === 0 && <p className="empty">لا يوجد موظفون في إجازة حالياً لهذا الكيان.</p>}

        {emp && openSettlement && preview && (
          <div className="preview-box">
            <div className="preview-row"><span>إجازة بدأت في</span><strong>{openSettlement.leaveStartDate}</strong></div>
            <div className="preview-row"><span>شهر المباشرة</span><strong>{monthLabel(preview.month)}</strong></div>
            <div className="preview-row"><span>أيام العمل المستحقة من شهر المباشرة</span><strong>{preview.workedDays} يوم (من {returnDate} حتى نهاية الشهر)</strong></div>
            <div className="preview-row net-row"><span>الراتب المتوقع لشهر المباشرة</span><strong>{fmt(preview.amount)} ر.س</strong></div>
          </div>
        )}

        <button className="btn-primary" onClick={registerReturn} disabled={!emp || !openSettlement}>
          تسجيل المباشرة وإنهاء الإجازة
        </button>
        <p className="note">
          عند التسجيل، سيظهر الموظف تلقائياً في كشف رواتب شهر المباشرة براتب جزئي محسوب من تاريخ المباشرة حتى نهاية الشهر،
          ويعود رصيد إجازته للاحتساب من هذا التاريخ في المرة القادمة.
        </p>
      </div>
    </div>
  );
}


export function HRReportsModule({ employees, companyId }) {
  const [withinDays, setWithinDays] = useState(30);
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [showPrint, setShowPrint] = useState(false);
  const companyEmployees = companyId === "all" ? employees : employees.filter((e) => e.company === companyId);

  const rows = collectExpiringEmployeeDocs(companyEmployees, "all", withinDays)
    .filter((r) => !docTypeFilter || r.doc.type === docTypeFilter);

  const printCompany = companyId !== "all" ? COMPANIES.find((c) => c.id === companyId) : null;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid">
          <label>خلال كم يوم<input type="number" value={withinDays} onChange={(e) => setWithinDays(Number(e.target.value) || 0)} /></label>
          <label>نوع المستند<select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}><option value="">كل الأنواع</option>{EMPLOYEE_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        <button className="btn-primary" onClick={() => setShowPrint(true)}>إصدار التقرير</button>
      </div>

      <div className="panel">
        <h3>الموظفون بمستندات تنتهي خلال {withinDays} يوم</h3>
        <table className="ledger-table">
          <thead><tr><th>الموظف</th><th>الشركة</th><th>نوع المستند</th><th>الرقم</th><th>تاريخ الانتهاء</th><th>الأيام المتبقية</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.employee.name}</td>
                <td>{COMPANIES.find((c) => c.id === r.employee.company)?.short}</td>
                <td>{r.doc.type}</td><td>{r.doc.number || "—"}</td><td>{r.doc.expiryDate}</td>
                <td className={r.days < 0 ? "balance-bad" : "doc-warning-text"}>{r.days < 0 ? `منتهٍ منذ ${Math.abs(r.days)} يوم` : `${r.days} يوم`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">لا توجد مستندات ضمن هذا النطاق.</p>}
      </div>

      {showPrint && (
        <PrintShell subtitle={`تقرير انتهاء المستندات — خلال ${withinDays} يوم`} company={printCompany} refNode={<div>عدد النتائج: <strong>{rows.length}</strong></div>} onClose={() => setShowPrint(false)}>
          <table className="ledger-table voucher-table">
            <thead><tr><th>الموظف</th><th>الشركة</th><th>نوع المستند</th><th>الرقم</th><th>تاريخ الانتهاء</th><th>الأيام المتبقية</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.employee.name}</td><td>{COMPANIES.find((c) => c.id === r.employee.company)?.short}</td>
                  <td>{r.doc.type}</td><td>{r.doc.number || "—"}</td><td>{r.doc.expiryDate}</td>
                  <td>{r.days < 0 ? `منتهٍ منذ ${Math.abs(r.days)} يوم` : `${r.days} يوم`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintShell>
      )}
    </div>
  );
}


export function HRModule({ employees, setEmployees, leaves, setLeaves, entries, setEntries, leaveSettlements, setLeaveSettlements, hrActions, setHrActions, payrollRuns, setPayrollRuns, unlockPin, companyId, tab, setTab }) {
  return (
    <div>
      <div className="section-title">
        <span className="eyebrow">الموارد البشرية</span>
        <h2>شئون الموظفين</h2>
      </div>
      <div className="report-tabs">
        {HR_TABS.map((t) => (
          <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === "directory" && <EmployeeDirectory employees={employees} setEmployees={setEmployees} companyId={companyId} />}
      {tab === "leaves" && <LeavesModule employees={employees} leaves={leaves} setLeaves={setLeaves} companyId={companyId} />}
      {tab === "leaveSettlement" && (
        <LeaveSettlementModule
          employees={employees} setEmployees={setEmployees}
          entries={entries} setEntries={setEntries}
          leaveSettlements={leaveSettlements} setLeaveSettlements={setLeaveSettlements}
          companyId={companyId}
        />
      )}
      {tab === "leaveReturn" && (
        <LeaveReturnModule
          employees={employees} setEmployees={setEmployees}
          leaveSettlements={leaveSettlements} setLeaveSettlements={setLeaveSettlements}
          companyId={companyId}
        />
      )}
      {tab === "actions" && <ActionsModule employees={employees} hrActions={hrActions} setHrActions={setHrActions} companyId={companyId} />}
      {tab === "payroll" && (
        <PayrollModule
          employees={employees} companyId={companyId} leaveSettlements={leaveSettlements}
          hrActions={hrActions} payrollRuns={payrollRuns} setPayrollRuns={setPayrollRuns}
          entries={entries} setEntries={setEntries} unlockPin={unlockPin}
        />
      )}
      {tab === "eos" && <EndOfServiceModule employees={employees} companyId={companyId} />}
      {tab === "hrReports" && <HRReportsModule employees={employees} companyId={companyId} />}
    </div>
  );
}
