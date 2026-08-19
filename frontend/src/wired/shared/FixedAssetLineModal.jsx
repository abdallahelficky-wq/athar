import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import EmployeeSearchSelect from "./EmployeeSearchSelect";

const emptyNewAsset = () => ({
  name: "", categoryId: "", serialNumber: "", chassisNumber: "", plateNumber: "",
  costCenterId: "", custodianEmployeeId: "", cost: "", usefulLifeYears: "5", salvageValue: "0",
  depreciationStartDate: "", depreciationMethod: "straight_line", isDepreciable: true,
});

/**
 * نافذة "أصل جديد/أصل موجود" — تُفتَح عند اختيار حساب مُعلَّم isFixedAssetAccount في سطر قيد يومية
 * عام (Phase F). "أصل جديد" يملأ بيانات أصل يُسجَّل فقط لحظة حفظ القيد (بلا قيد خاص به منفصل —
 * هذا السطر نفسه هو قيد الاقتناء)، ويُعيد cost ليُملأ في خانة مدين السطر تلقائياً. "أصل موجود"
 * يربط السطر بأصل مسجَّل بالفعل بلا أي تأثير على مبلغه (لتوثيق تكلفة إضافية على نفس الأصل مثلاً).
 *
 * فئة الأصل (categoryId) إلزامية دائماً هنا — بلا فئة، الأصل لا يرث حسابَي مجمع/مصروف الإهلاك ويقع
 * على الحسابات الاحتياطية المشتركة بدل حسابات الشركة المخصَّصة (خلل حقيقي اكتُشف في بيانات اختبار
 * فعلية بعد إطلاق Phase F، أصلاً كانت هذه النافذة تعرض قائمة تصنيف نصية حرة بلا أي ربط بفئات
 * الإعدادات الحقيقية). تُعرَض فقط الفئات التي حساب اقتنائها (assetAccountId) مطابق لحساب هذا السطر
 * تحديداً — بما أن المستخدم اختار الحساب أصلاً عند فتح هذه النافذة، فالفئة يجب أن "تتبع" هذا الحساب
 * لا العكس، وإلا يتناقض حساب الأصل المسجَّل مع حساب سطر القيد الفعلي الذي رُحِّلت عليه التكلفة.
 */
export default function FixedAssetLineModal({ existingAssets, assetCategories, lineAccountId, costCenters, employees, initial, onClose, onConfirm }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(initial?.fixedAssetId ? "existing" : "new");
  const [existingId, setExistingId] = useState(initial?.fixedAssetId || "");
  const matchedCategories = useMemo(
    () => assetCategories.filter((c) => c.assetAccountId === lineAccountId),
    [assetCategories, lineAccountId],
  );
  const [form, setForm] = useState(() => ({
    ...emptyNewAsset(),
    categoryId: matchedCategories.length === 1 ? matchedCategories[0].id : "",
    ...(initial?.newFixedAsset || {}),
  }));
  const [error, setError] = useState("");

  const activeAssets = useMemo(() => existingAssets.filter((a) => a.status !== "disposed"), [existingAssets]);
  const annualDepreciationRate = Number(form.usefulLifeYears) > 0 ? (100 / Number(form.usefulLifeYears)).toFixed(2) : null;

  const confirmExisting = () => {
    if (!existingId) { setError(t("journalModals.fixedAssetLine.errChooseAsset")); return; }
    onConfirm({ fixedAssetId: existingId, newFixedAsset: null, debit: null });
  };

  const confirmNew = () => {
    if (!form.name.trim()) { setError(t("journalModals.fixedAssetLine.errNameRequired")); return; }
    if (!form.categoryId) { setError(t("journalModals.fixedAssetLine.errCategoryRequired")); return; }
    if (!Number(form.cost) || Number(form.cost) <= 0) { setError(t("journalModals.fixedAssetLine.errCostRequired")); return; }
    if (!Number(form.usefulLifeYears) || Number(form.usefulLifeYears) <= 0) { setError(t("journalModals.fixedAssetLine.errUsefulLifeRequired")); return; }
    onConfirm({
      fixedAssetId: null,
      newFixedAsset: {
        name: form.name.trim(), categoryId: form.categoryId,
        serialNumber: form.serialNumber || undefined, chassisNumber: form.chassisNumber || undefined, plateNumber: form.plateNumber || undefined,
        costCenterId: form.costCenterId || undefined, custodianEmployeeId: form.custodianEmployeeId || undefined,
        depreciationStartDate: form.depreciationStartDate || undefined,
        usefulLifeYears: Number(form.usefulLifeYears), salvageValue: Number(form.salvageValue) || 0,
        depreciationMethod: form.depreciationMethod, isDepreciable: form.isDepreciable,
      },
      debit: Number(form.cost),
    });
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="unpost-confirm-box">
        <div className="modal-title-row">
          <h3>{t("journalModals.fixedAssetLine.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t("common.close")}>×</button>
        </div>
        <div className="form-btn-group" style={{ marginBottom: 14 }}>
          <button className={mode === "new" ? "btn-primary" : "btn-ghost"} onClick={() => { setMode("new"); setError(""); }}>{t("journalModals.fixedAssetLine.newTab")}</button>
          <button className={mode === "existing" ? "btn-primary" : "btn-ghost"} onClick={() => { setMode("existing"); setError(""); }}>{t("journalModals.fixedAssetLine.existingTab")}</button>
        </div>

        {mode === "existing" ? (
          <div className="form-grid">
            <label>{t("journalModals.fixedAssetLine.chooseAssetLabel")}
              <select value={existingId} onChange={(e) => setExistingId(e.target.value)}>
                <option value="">{t("journalModals.fixedAssetLine.chooseOption")}</option>
                {activeAssets.map((a) => <option key={a.id} value={a.id}>{a.assetNumber} — {a.name}</option>)}
              </select>
            </label>
          </div>
        ) : matchedCategories.length === 0 ? (
          <p className="balance-bad">{t("journalModals.fixedAssetLine.noCategoryWarning")}</p>
        ) : (
          <div className="form-grid">
            <label>{t("journalModals.fixedAssetLine.nameLabel")}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
            <label>{t("journalModals.fixedAssetLine.categoryLabel")}
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">{t("journalModals.fixedAssetLine.chooseOption")}</option>
                {matchedCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>{t("journalModals.fixedAssetLine.costLabel")}<input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></label>
            <label>{t("journalModals.fixedAssetLine.serialLabel")}<input type="text" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></label>
            <label>{t("journalModals.fixedAssetLine.chassisLabel")}<input type="text" value={form.chassisNumber} onChange={(e) => setForm({ ...form, chassisNumber: e.target.value })} /></label>
            <label>{t("journalModals.fixedAssetLine.plateLabel")}<input type="text" value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} /></label>
            <label>{t("journalModals.fixedAssetLine.locationLabel")}
              <select value={form.costCenterId} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
                <option value="">{t("journalModals.fixedAssetLine.noneOption")}</option>
                {costCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>{t("journalModals.fixedAssetLine.custodianLabel")}
              <EmployeeSearchSelect employees={employees} value={form.custodianEmployeeId} onChange={(id) => setForm({ ...form, custodianEmployeeId: id })} allowClear clearLabel={t("journalModals.fixedAssetLine.noneOption")} />
            </label>
            <label>{t("journalModals.fixedAssetLine.depreciationStartLabel")}<input type="date" value={form.depreciationStartDate} onChange={(e) => setForm({ ...form, depreciationStartDate: e.target.value })} /></label>
            <label>{t("journalModals.fixedAssetLine.usefulLifeLabel")}<input type="number" step="0.1" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} /></label>
            <label>{t("journalModals.fixedAssetLine.annualRateLabel")}<input type="text" value={annualDepreciationRate ? `${annualDepreciationRate}%` : "—"} disabled /></label>
            <label>{t("journalModals.fixedAssetLine.methodLabel")}
              <select value={form.depreciationMethod} onChange={(e) => setForm({ ...form, depreciationMethod: e.target.value })}>
                <option value="straight_line">{t("fixedAssets.depreciationMethod.straight_line")}</option>
                <option value="declining_balance" disabled>{t("fixedAssets.register.decliningSoon")}</option>
              </select>
            </label>
            <label>{t("journalModals.fixedAssetLine.salvageLabel")}<input type="number" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={form.isDepreciable} onChange={(e) => setForm({ ...form, isDepreciable: e.target.checked })} />{t("journalModals.fixedAssetLine.isDepreciable")}</label>
          </div>
        )}

        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button
            className="btn-primary"
            onClick={mode === "existing" ? confirmExisting : confirmNew}
            disabled={mode === "new" && matchedCategories.length === 0}
          >
            {t("journalModals.fixedAssetLine.linkBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
