import TaxCategoryFields from "../shared/TaxCategoryFields";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { createItem } from "../../api/items";
import AccountSearchSelect from "../shared/AccountSearchSelect";

/** نافذة فرعية لإضافة صنف قابل للبيع بسرعة من داخل سطر فاتورة المبيعات — تُنشئ صنفاً حقيقياً من نوع "خدمة" بحساب إيراد واحد، وهو أبسط الأنواع القابلة للبيع؛ لضبط بيانات أكثر تفصيلاً (مخزون، مادة أولية...) استخدم شاشة "الأصناف والمنتجات" مباشرة. */
export default function NewSellableItemModal({ companyId, accounts, initialName, onClose, onCreated }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName || "");
  const [salePrice, setSalePrice] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [tax, setTax] = useState({ taxCategoryCode: "S", priceIncludesVat: true });
  const [revenueAccountId, setRevenueAccountId] = useState(accounts[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim() || !revenueAccountId) { setError(t("sales.newSellableItemModal.errRequired")); return; }
    setSaving(true);
    setError("");
    try {
      const item = await createItem({
        companyId, name: name.trim(), code: `SVC-${Date.now()}`, type: "service",
        salePrice: Number(salePrice || 0), ...tax, nameEn: nameEn.trim() || null, revenueAccountId,
      });
      onCreated(item);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay nested-modal-overlay" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="unpost-confirm-box">
        <div className="modal-title-row">
          <h3>{t("sales.newSellableItemModal.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("sales.newSellableItemModal.close")}>×</button>
        </div>
        <div className="form-grid">
          <label>{t("itemTax.nameAr")}<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label>{t("itemTax.nameEn")}<input value={nameEn} dir="ltr" onChange={(e) => setNameEn(e.target.value)} /></label>
          <label>{t("sales.newSellableItemModal.salePrice")}<input type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="0.00" /></label>
          <label>{t("sales.newSellableItemModal.revenueAccount")}
            <AccountSearchSelect accounts={accounts} value={revenueAccountId} onChange={setRevenueAccountId} />
          </label>
          <TaxCategoryFields value={tax} onChange={(patch) => setTax({ ...tax, ...patch })} />
          <label>{t("itemTax.priceBasis")}<select value={String(tax.priceIncludesVat)} onChange={(e) => setTax({ ...tax, priceIncludesVat: e.target.value === "true" })}><option value="true">{t("itemTax.inclusive")}</option><option value="false">{t("itemTax.exclusive")}</option></select></label>
        </div>
        <p className="note">{t("sales.newSellableItemModal.note")}</p>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("sales.newSellableItemModal.cancel")}</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t("sales.newSellableItemModal.saving") : t("sales.newSellableItemModal.save")}</button>
        </div>
      </div>
    </div>
  );
}
