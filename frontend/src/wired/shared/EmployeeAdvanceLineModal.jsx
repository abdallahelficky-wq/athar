import React, { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState(initial?.employeeAdvanceId ? "existing" : "new");
  const [existingId, setExistingId] = useState(initial?.employeeAdvanceId || "");
  const [form, setForm] = useState(() => ({ ...emptyNewAdvance(), employeeId: initial?.employeeId || "" }));
  const [error, setError] = useState("");

  const activeAdvances = existingAdvances.filter((a) => a.status === "active");
  const employeeName = (id) => employees.find((e) => e.id === id)?.name || "؟";

  const confirmExisting = () => {
    if (!existingId) { setError(t("journalModals.employeeAdvanceLine.errChooseAdvance")); return; }
    const advance = existingAdvances.find((a) => a.id === existingId);
    onConfirm({ employeeAdvanceId: existingId, newEmployeeAdvance: null, debit: null, employeeId: advance?.employeeId });
  };

  const confirmNew = () => {
    if (!form.employeeId) { setError(t("journalModals.employeeAdvanceLine.errBeneficiaryRequired")); return; }
    if (!Number(form.amount) || Number(form.amount) <= 0) { setError(t("journalModals.employeeAdvanceLine.errAmountRequired")); return; }
    onConfirm({
      employeeAdvanceId: null,
      newEmployeeAdvance: { monthlyInstallment: form.monthlyInstallment ? Number(form.monthlyInstallment) : undefined },
      debit: Number(form.amount),
      employeeId: form.employeeId,
    });
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="unpost-confirm-box">
        <div className="modal-title-row">
          <h3>{t("journalModals.employeeAdvanceLine.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t("common.close")}>×</button>
        </div>
        <div className="form-btn-group" style={{ marginBottom: 14 }}>
          <button className={mode === "new" ? "btn-primary" : "btn-ghost"} onClick={() => { setMode("new"); setError(""); }}>{t("journalModals.employeeAdvanceLine.newTab")}</button>
          <button className={mode === "existing" ? "btn-primary" : "btn-ghost"} onClick={() => { setMode("existing"); setError(""); }}>{t("journalModals.employeeAdvanceLine.existingTab")}</button>
        </div>

        {mode === "existing" ? (
          <div className="form-grid">
            <label>{t("journalModals.employeeAdvanceLine.chooseAdvanceLabel")}
              <select value={existingId} onChange={(e) => setExistingId(e.target.value)}>
                <option value="">{t("journalModals.employeeAdvanceLine.chooseOption")}</option>
                {activeAdvances.map((a) => (
                  <option key={a.id} value={a.id}>{employeeName(a.employeeId)} — {t("journalModals.employeeAdvanceLine.remainingLabel", { amount: Number(a.remainingBalance).toLocaleString(i18n.language === "en" ? "en-US" : "ar-SA") })}</option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <div className="form-grid">
            <label>{t("journalModals.employeeAdvanceLine.beneficiaryLabel")}
              <EmployeeSearchSelect employees={employees} value={form.employeeId} onChange={(id) => setForm({ ...form, employeeId: id })} autoFocus />
            </label>
            <label>{t("journalModals.employeeAdvanceLine.amountLabel")}<input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
            <label>{t("journalModals.employeeAdvanceLine.installmentLabel")}<input type="number" value={form.monthlyInstallment} onChange={(e) => setForm({ ...form, monthlyInstallment: e.target.value })} /></label>
          </div>
        )}

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn-primary" onClick={mode === "existing" ? confirmExisting : confirmNew}>{t("journalModals.employeeAdvanceLine.linkBtn")}</button>
        </div>
      </div>
    </div>
  );
}
