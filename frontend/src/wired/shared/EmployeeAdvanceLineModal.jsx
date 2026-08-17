import React, { useState } from "react";
import EmployeeSearchSelect from "./EmployeeSearchSelect";

const emptyNewAdvance = () => ({ employeeId: "", amount: "", monthlyInstallment: "" });

/**
 * نافذة "سلفة جديدة/سلفة موجودة" — تُفتَح عند اختيار حساب مُعلَّم isEmployeeAdvanceAccount في سطر
 * قيد يومية عام (Phase F). "سلفة جديدة" تسجّل سلفة تُصرَف عبر هذا السطر تحديداً (بلا قيد خاص بها
 * منفصل)، وتملأ المبلغ في خانة مدين السطر تلقائياً؛ لو حُدِّد قسط شهري، تُنشأ خصماً تلقائياً متكرراً
 * من الرواتب يتوقف بمجرد السداد الكامل (Phase E). "سلفة موجودة" تربط السطر بسلفة سابقة بلا تأثير
 * على مبلغها (لتوثيق حركة إضافية مرتبطة بها).
 */
export default function EmployeeAdvanceLineModal({ existingAdvances, employees, initial, onClose, onConfirm }) {
  const [mode, setMode] = useState(initial?.employeeAdvanceId ? "existing" : "new");
  const [existingId, setExistingId] = useState(initial?.employeeAdvanceId || "");
  const [form, setForm] = useState(() => ({ ...emptyNewAdvance(), employeeId: initial?.employeeId || "" }));
  const [error, setError] = useState("");

  const activeAdvances = existingAdvances.filter((a) => a.status === "active");
  const employeeName = (id) => employees.find((e) => e.id === id)?.name || "؟";

  const confirmExisting = () => {
    if (!existingId) { setError("اختر سلفة من القائمة"); return; }
    const advance = existingAdvances.find((a) => a.id === existingId);
    onConfirm({ employeeAdvanceId: existingId, newEmployeeAdvance: null, debit: null, employeeId: advance?.employeeId });
  };

  const confirmNew = () => {
    if (!form.employeeId) { setError("اختر الموظف المستفيد"); return; }
    if (!Number(form.amount) || Number(form.amount) <= 0) { setError("أدخل مبلغ السلفة"); return; }
    onConfirm({
      employeeAdvanceId: null,
      newEmployeeAdvance: { monthlyInstallment: form.monthlyInstallment ? Number(form.monthlyInstallment) : undefined },
      debit: Number(form.amount),
      employeeId: form.employeeId,
    });
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay">
      <div className="unpost-confirm-box">
        <h3>ربط السطر بسلفة موظف</h3>
        <div className="form-btn-group" style={{ marginBottom: 14 }}>
          <button className={mode === "new" ? "btn-primary" : "btn-ghost"} onClick={() => { setMode("new"); setError(""); }}>سلفة جديدة</button>
          <button className={mode === "existing" ? "btn-primary" : "btn-ghost"} onClick={() => { setMode("existing"); setError(""); }}>سلفة موجودة</button>
        </div>

        {mode === "existing" ? (
          <div className="form-grid">
            <label>اختر السلفة
              <select value={existingId} onChange={(e) => setExistingId(e.target.value)}>
                <option value="">— اختر —</option>
                {activeAdvances.map((a) => (
                  <option key={a.id} value={a.id}>{employeeName(a.employeeId)} — متبقٍ {Number(a.remainingBalance).toLocaleString("ar-SA")}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="form-grid">
            <label>الموظف المستفيد
              <EmployeeSearchSelect employees={employees} value={form.employeeId} onChange={(id) => setForm({ ...form, employeeId: id })} autoFocus />
            </label>
            <label>مبلغ السلفة (يُملأ في خانة المدين تلقائياً)<input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label>القسط الشهري (اختياري — لخصم تلقائي متكرر من الرواتب)<input type="number" value={form.monthlyInstallment} onChange={(e) => setForm({ ...form, monthlyInstallment: e.target.value })} /></label>
          </div>
        )}

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" onClick={mode === "existing" ? confirmExisting : confirmNew}>ربط السطر</button>
        </div>
      </div>
    </div>
  );
}
