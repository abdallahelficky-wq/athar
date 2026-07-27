import React, { useEffect, useState } from "react";
import { listEmployees, createEmployee, updateEmployee, deleteEmployee } from "../../api/employees";
import { DEPARTMENTS, fmt } from "../../legacy/constants";
import { NATIONALITIES, EMPLOYEE_DOC_TYPES } from "../../legacy/hr";

const emptyForm = () => ({
  name: "", jobTitle: "", department: DEPARTMENTS[0], hireDate: new Date().toISOString().slice(0, 10),
  contractType: "unlimited", contractEnd: "", basicSalary: "", housingAllowance: "", transportAllowance: "",
  gosiApplicable: true, nationality: NATIONALITIES[0], dateOfBirth: "", bankName: "", bankAccount: "",
  probationEndDate: "", probationEvaluated: false, documents: [],
});

export default function EmployeeDirectoryTab({ companyId }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listEmployees(companyId).then(setEmployees).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const save = async () => {
    if (!form.name || !form.basicSalary) return;
    try {
      const payload = {
        ...form, companyId,
        basicSalary: Number(form.basicSalary), housingAllowance: Number(form.housingAllowance || 0),
        transportAllowance: Number(form.transportAllowance || 0), contractEnd: form.contractEnd || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        probationEndDate: form.probationEndDate || null,
        documents: form.documents.map((d) => ({ ...d, expiryDate: d.expiryDate || undefined })),
      };
      if (editingId) await updateEmployee(editingId, payload);
      else await createEmployee(payload);
      setForm(emptyForm());
      setEditingId(null);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (e) => {
    setEditingId(e.id);
    setForm({
      ...emptyForm(), ...e,
      hireDate: e.hireDate.slice(0, 10), contractEnd: e.contractEnd?.slice(0, 10) || "",
      dateOfBirth: e.dateOfBirth?.slice(0, 10) || "",
      probationEndDate: e.probationEndDate?.slice(0, 10) || "",
      documents: (e.documents || []).map((d) => ({ ...d, expiryDate: d.expiryDate?.slice(0, 10) || "" })),
    });
  };

  const remove = async (e) => {
    if (!window.confirm(`حذف ملف الموظف "${e.name}"؟`)) return;
    try {
      await deleteEmployee(e.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const updateDoc = (idx, field, value) => setForm((f) => ({ ...f, documents: f.documents.map((d, i) => (i === idx ? { ...d, [field]: value } : d)) }));
  const addDoc = () => setForm((f) => ({ ...f, documents: [...f.documents, { type: EMPLOYEE_DOC_TYPES[0], number: "", expiryDate: "" }] }));
  const removeDoc = (idx) => setForm((f) => ({ ...f, documents: f.documents.filter((_, i) => i !== idx) }));

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">تعديل ملف الموظف — {form.name}</div>}
        <div className="form-grid">
          <label>الاسم<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>المسمّى الوظيفي<input type="text" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></label>
          <label>القسم<select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>الجنسية<select value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })}>{NATIONALITIES.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>تاريخ الميلاد<input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
          <label>تاريخ المباشرة<input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} /></label>
          <label>نوع العقد
            <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })}>
              <option value="unlimited">غير محدد المدة</option><option value="limited">محدد المدة</option>
            </select>
          </label>
          {form.contractType === "limited" && <label>نهاية العقد<input type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} /></label>}
          <label>نهاية فترة التجربة (اختياري)<input type="date" value={form.probationEndDate} onChange={(e) => setForm({ ...form, probationEndDate: e.target.value })} /></label>
          {form.probationEndDate && (
            <label className="checkbox-field">
              <input type="checkbox" checked={form.probationEvaluated} onChange={(e) => setForm({ ...form, probationEvaluated: e.target.checked })} />
              تم تقييم الموظف بعد انتهاء فترة التجربة
            </label>
          )}
          <label>الأساسي<input type="number" value={form.basicSalary} onChange={(e) => setForm({ ...form, basicSalary: e.target.value })} /></label>
          <label>بدل سكن<input type="number" value={form.housingAllowance} onChange={(e) => setForm({ ...form, housingAllowance: e.target.value })} /></label>
          <label>بدل نقل<input type="number" value={form.transportAllowance} onChange={(e) => setForm({ ...form, transportAllowance: e.target.value })} /></label>
          <label>اسم البنك<input type="text" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></label>
          <label>رقم الحساب / الآيبان<input type="text" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} /></label>
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

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group" style={{ marginTop: 14 }}>
          {editingId && <button className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); }}>إلغاء التعديل</button>}
          <button className="btn-primary" onClick={save}>{editingId ? "حفظ التعديلات" : "حفظ ملف الموظف"}</button>
        </div>
      </div>

      {loading ? <p className="empty">جارٍ التحميل...</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الاسم</th><th>القسم</th><th>الأساسي</th><th>حالة الإجازة</th><th></th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td><td>{e.department || "—"}</td><td className="num">{fmt(e.basicSalary)}</td>
                  <td><span className="status-badge">{e.leaveStatus === "onLeave" ? "في إجازة" : "نشط"}</span></td>
                  <td className="row-actions">
                    <button className="btn-ghost" onClick={() => startEdit(e)}>تعديل</button>
                    <button className="btn-ghost" onClick={() => remove(e)}>حذف</button>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td className="empty" colSpan={5}>لا يوجد موظفون بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
