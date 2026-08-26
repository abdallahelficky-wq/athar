import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { listEmployees, createEmployee, updateEmployee, deleteEmployee } from "../../api/employees";
import { getEmployeePayrollComponents, setEmployeePayrollComponents } from "../../api/payrollSettings";
import { DEPARTMENTS, fmt } from "../../legacy/constants";
import { NATIONALITIES, EMPLOYEE_DOC_TYPES } from "../../legacy/hr";
import { routes } from "../../routes";
import AttachmentsPanel from "../shared/AttachmentsPanel";

const emptyForm = () => ({
  name: "", employeeNumber: "", idNumber: "", gender: "", maritalStatus: "",
  jobTitle: "", department: DEPARTMENTS[0], workLocation: "", hireDate: new Date().toISOString().slice(0, 10),
  contractType: "unlimited", contractEnd: "", basicSalary: "", housingAllowance: "", transportAllowance: "",
  gosiApplicable: true, nationality: NATIONALITIES[0], dateOfBirth: "", phone: "", alternatePhone: "",
  personalEmail: "", workEmail: "", address: "", emergencyContactName: "", emergencyContactPhone: "",
  emergencyContactRelation: "", bankName: "", bankAccount: "", medicalInsuranceProvider: "",
  medicalInsuranceNumber: "", annualLeaveDays: 21, notes: "",
  probationEndDate: "", probationEvaluated: false, documents: [],
});

export default function EmployeeDirectoryTab({ companyId }) {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [payrollComponents, setPayrollComponents] = useState([]);
  const [payrollError, setPayrollError] = useState("");

  const reloadPayrollComponents = (id) => {
    if (!id) { setPayrollComponents([]); return; }
    getEmployeePayrollComponents(id).then(setPayrollComponents).catch((e) => setPayrollError(e.message));
  };

  const togglePayrollComponent = (componentId) => setPayrollComponents((list) => list.map((c) => (c.componentId === componentId ? { ...c, assigned: !c.assigned } : c)));
  const setPayrollFixedValue = (componentId, fixedValue) => setPayrollComponents((list) => list.map((c) => (c.componentId === componentId ? { ...c, fixedValue } : c)));
  const savePayrollComponents = async () => {
    try {
      await setEmployeePayrollComponents(editingId, payrollComponents.map((c) => ({ componentId: c.componentId, isActive: c.assigned, fixedValue: c.needsFixedValue ? Number(c.fixedValue || 0) : null })));
      reloadPayrollComponents(editingId);
    } catch (err) { setPayrollError(err.message); }
  };

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
        employeeNumber: form.employeeNumber.trim() || undefined,
        idNumber: form.idNumber.trim() || undefined,
        phone: form.phone.trim() || undefined,
        alternatePhone: form.alternatePhone.trim() || undefined,
        personalEmail: form.personalEmail.trim() || undefined,
        workEmail: form.workEmail.trim() || undefined,
        basicSalary: Number(form.basicSalary), housingAllowance: Number(form.housingAllowance || 0),
        transportAllowance: Number(form.transportAllowance || 0), annualLeaveDays: Number(form.annualLeaveDays || 0),
        contractEnd: form.contractEnd || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        probationEndDate: form.probationEndDate || null,
        documents: form.documents.map((d) => ({ ...d, expiryDate: d.expiryDate || undefined })),
      };
      if (editingId) await updateEmployee(editingId, payload);
      else await createEmployee(payload);
      setForm(emptyForm());
      setEditingId(null);
      setPayrollComponents([]);
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
    reloadPayrollComponents(e.id);
  };

  const remove = async (e) => {
    if (!window.confirm(t("hr.directory.confirmDelete", { name: e.name }))) return;
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

  const exportEmployees = () => {
    const rows = employees.map((e) => ({
      [t("hr.directory.export.employeeNumber")]: e.employeeNumber || "",
      [t("hr.directory.export.name")]: e.name,
      [t("hr.directory.export.idNumber")]: e.idNumber || "",
      [t("hr.directory.export.nationality")]: e.nationality || "",
      [t("hr.directory.export.jobTitle")]: e.jobTitle || "",
      [t("hr.directory.export.department")]: e.department || "",
      [t("hr.directory.export.workLocation")]: e.workLocation || "",
      [t("hr.directory.export.phone")]: e.phone || "",
      [t("hr.directory.export.workEmail")]: e.workEmail || "",
      [t("hr.directory.export.hireDate")]: e.hireDate?.slice(0, 10) || "",
      [t("hr.directory.export.contractType")]: e.contractType === "limited" ? t("hr.directory.contractLimited") : t("hr.directory.contractUnlimited"),
      [t("hr.directory.export.contractEnd")]: e.contractEnd?.slice(0, 10) || "",
      [t("hr.directory.export.basicSalary")]: Number(e.basicSalary || 0),
      [t("hr.directory.export.housingAllowance")]: Number(e.housingAllowance || 0),
      [t("hr.directory.export.transportAllowance")]: Number(e.transportAllowance || 0),
      [t("hr.directory.export.bankAccount")]: e.bankAccount || "",
      [t("hr.directory.export.annualLeaveDays")]: e.annualLeaveDays ?? 21,
      [t("hr.directory.export.status")]: e.status === "terminated" ? t("hr.directory.statusTerminated") : t("hr.directory.statusActive"),
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = Object.keys(rows[0] || {}).map((key) => ({ wch: Math.max(14, key.length + 4) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, t("hr.directory.export.sheetName"));
    XLSX.writeFile(workbook, `employees-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        {editingId && <div className="edit-banner">{t("hr.directory.editingBanner", { name: form.name })}</div>}
        <h3 className="sub-head">{t("hr.directory.personalSection")}</h3>
        <div className="form-grid">
          <label>{t("hr.directory.name")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>{t("hr.directory.employeeNumber")}<input type="text" value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} /></label>
          <label>{t("hr.directory.idNumber")}<input type="text" value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} /></label>
          <label>{t("hr.directory.gender")}<select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">—</option><option value="male">{t("hr.directory.genderMale")}</option><option value="female">{t("hr.directory.genderFemale")}</option></select></label>
          <label>{t("hr.directory.maritalStatus")}<select value={form.maritalStatus} onChange={(e) => setForm({ ...form, maritalStatus: e.target.value })}><option value="">—</option><option value="single">{t("hr.directory.single")}</option><option value="married">{t("hr.directory.married")}</option></select></label>
          <label>{t("hr.directory.jobTitle")}<input type="text" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></label>
          <label>{t("hr.directory.department")}<select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>{t("hr.directory.workLocation")}<input type="text" value={form.workLocation} onChange={(e) => setForm({ ...form, workLocation: e.target.value })} /></label>
          <label>{t("hr.directory.nationality")}<select value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })}>{NATIONALITIES.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>{t("hr.directory.dateOfBirth")}<input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></label>
          <label>{t("hr.directory.phone")}<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>{t("hr.directory.alternatePhone")}<input type="tel" value={form.alternatePhone} onChange={(e) => setForm({ ...form, alternatePhone: e.target.value })} /></label>
          <label>{t("hr.directory.personalEmail")}<input type="email" value={form.personalEmail} onChange={(e) => setForm({ ...form, personalEmail: e.target.value })} /></label>
          <label>{t("hr.directory.workEmail")}<input type="email" value={form.workEmail} onChange={(e) => setForm({ ...form, workEmail: e.target.value })} /></label>
          <label>{t("hr.directory.address")}<input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
          <label>{t("hr.directory.emergencyContactName")}<input type="text" value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} /></label>
          <label>{t("hr.directory.emergencyContactPhone")}<input type="tel" value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} /></label>
          <label>{t("hr.directory.emergencyContactRelation")}<input type="text" value={form.emergencyContactRelation} onChange={(e) => setForm({ ...form, emergencyContactRelation: e.target.value })} /></label>
        </div>

        <h3 className="sub-head">{t("hr.directory.employmentSection")}</h3>
        <div className="form-grid">
          <label>{t("hr.directory.hireDate")}<input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} /></label>
          <label>{t("hr.directory.contractType")}
            <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })}>
              <option value="unlimited">{t("hr.directory.contractUnlimited")}</option><option value="limited">{t("hr.directory.contractLimited")}</option>
            </select>
          </label>
          {form.contractType === "limited" && <label>{t("hr.directory.contractEnd")}<input type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} /></label>}
          <label>{t("hr.directory.probationEndDate")}<input type="date" value={form.probationEndDate} onChange={(e) => setForm({ ...form, probationEndDate: e.target.value })} /></label>
          {form.probationEndDate && (
            <label className="checkbox-field">
              <input type="checkbox" checked={form.probationEvaluated} onChange={(e) => setForm({ ...form, probationEvaluated: e.target.checked })} />
              {t("hr.directory.probationEvaluated")}
            </label>
          )}
          <label>{t("hr.directory.basicSalary")}<input type="number" value={form.basicSalary} onChange={(e) => setForm({ ...form, basicSalary: e.target.value })} /></label>
          <label>{t("hr.directory.housingAllowance")}<input type="number" value={form.housingAllowance} onChange={(e) => setForm({ ...form, housingAllowance: e.target.value })} /></label>
          <label>{t("hr.directory.transportAllowance")}<input type="number" value={form.transportAllowance} onChange={(e) => setForm({ ...form, transportAllowance: e.target.value })} /></label>
          <label>{t("hr.directory.annualLeaveDays")}<input type="number" min="0" value={form.annualLeaveDays} onChange={(e) => setForm({ ...form, annualLeaveDays: e.target.value })} /></label>
          <label>{t("hr.directory.bankName")}<input type="text" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></label>
          <label>{t("hr.directory.bankAccount")}<input type="text" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} /></label>
          <label>{t("hr.directory.medicalInsuranceProvider")}<input type="text" value={form.medicalInsuranceProvider} onChange={(e) => setForm({ ...form, medicalInsuranceProvider: e.target.value })} /></label>
          <label>{t("hr.directory.medicalInsuranceNumber")}<input type="text" value={form.medicalInsuranceNumber} onChange={(e) => setForm({ ...form, medicalInsuranceNumber: e.target.value })} /></label>
          <label className="checkbox-field">
            <input type="checkbox" checked={form.gosiApplicable} onChange={(e) => setForm({ ...form, gosiApplicable: e.target.checked })} />
            {t("hr.directory.gosiApplicable")}
          </label>
        </div>
        <label>{t("hr.directory.notes")}<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></label>

        <h3 className="sub-head">{t("hr.directory.docsTitle")}</h3>
        <div className="lines-table-wrap">
          <table className="lines-table">
            <thead><tr><th>{t("hr.directory.docTable.type")}</th><th>{t("hr.directory.docTable.number")}</th><th>{t("hr.directory.docTable.expiry")}</th><th></th></tr></thead>
            <tbody>
              {form.documents.map((d, idx) => (
                <tr key={idx}>
                  <td><select value={d.type} onChange={(e) => updateDoc(idx, "type", e.target.value)}>{EMPLOYEE_DOC_TYPES.map((t2) => <option key={t2}>{t2}</option>)}</select></td>
                  <td><input type="text" value={d.number} onChange={(e) => updateDoc(idx, "number", e.target.value)} /></td>
                  <td><input type="date" value={d.expiryDate} onChange={(e) => updateDoc(idx, "expiryDate", e.target.value)} /></td>
                  <td><button className="btn-remove-line" onClick={() => removeDoc(idx)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn-ghost" onClick={addDoc}>{t("hr.directory.addDoc")}</button>
        {editingId && <AttachmentsPanel entityType="employee" entityId={editingId} title={t("hr.directory.attachmentsTitle")} />}

        {editingId && payrollComponents.length > 0 && (
          <>
            <h3 className="sub-head">{t("hr.directory.payrollComponentsTitle")}</h3>
            <p className="note">{t("hr.directory.payrollComponentsNote")}</p>
            {payrollError && <p className="balance-bad">{payrollError}</p>}
            <div className="lines-table-wrap">
              <table className="lines-table">
                <thead><tr><th></th><th>{t("hr.directory.payrollTable.component")}</th><th>{t("hr.directory.payrollTable.fixedValue")}</th></tr></thead>
                <tbody>
                  {payrollComponents.map((c) => (
                    <tr key={c.componentId}>
                      <td><input type="checkbox" checked={c.assigned} onChange={() => togglePayrollComponent(c.componentId)} /></td>
                      <td>{c.name}</td>
                      <td>
                        {c.needsFixedValue && c.assigned ? (
                          <input type="number" value={c.fixedValue ?? ""} onChange={(e) => setPayrollFixedValue(c.componentId, e.target.value)} />
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-ghost" onClick={savePayrollComponents}>{t("hr.directory.savePayrollComponents")}</button>
          </>
        )}

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group" style={{ marginTop: 14 }}>
          {editingId && <button className="btn-ghost" onClick={() => { setEditingId(null); setForm(emptyForm()); setPayrollComponents([]); }}>{t("hr.directory.cancelEdit")}</button>}
          <button className="btn-primary" onClick={save}>{editingId ? t("hr.directory.saveChanges") : t("hr.directory.saveNew")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("common.loading")}</p> : (
        <div className="panel">
          <div className="form-btn-group" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{t("hr.directory.listTitle")}</h3>
            <button className="btn-ghost" onClick={exportEmployees} disabled={employees.length === 0}>{t("hr.directory.exportExcel")}</button>
          </div>
          <table className="ledger-table">
            <thead><tr><th>{t("hr.directory.table.name")}</th><th>{t("hr.directory.table.department")}</th><th>{t("hr.directory.table.basicSalary")}</th><th>{t("hr.directory.table.leaveStatus")}</th><th></th></tr></thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td><td>{e.department || "—"}</td><td className="num">{fmt(e.basicSalary)}</td>
                  <td><span className="status-badge">{e.leaveStatus === "onLeave" ? t("hr.directory.statusOnLeave") : t("hr.directory.statusActive")}</span></td>
                  <td className="row-actions">
                    {e.accountId && (
                      <Link className="btn-ghost" to={routes.accountLedger(e.accountId)}>{t("hr.directory.viewAccount")}</Link>
                    )}
                    <button className="btn-ghost" onClick={() => startEdit(e)}>{t("common.edit")}</button>
                    <button className="btn-ghost" onClick={() => remove(e)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && <tr><td className="empty" colSpan={5}>{t("hr.directory.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
