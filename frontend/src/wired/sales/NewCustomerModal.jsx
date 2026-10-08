import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { createCustomer } from "../../api/customers";

/** نافذة فرعية (nested modal) لإضافة عميل جديد بسرعة من داخل نافذة فاتورة المبيعات */
export default function NewCustomerModal({ companyId, initialName, onClose, onCreated }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName || "");
  const [vatNumber, setVatNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // العنوان الوطني — يظهر ويُرسَل فقط لعميل له رقم ضريبي (B2B، فواتير قياسية لزاتكا): الخادم يرفض حفظه بدونه (BR-KSA-63)،
  // وبلا هذه الحقول كانت إضافة عميل ضريبي من هنا طريقاً مسدوداً. عميل بلا رقم ضريبي لا يُطلَب منه شيء.
  const [address, setAddress] = useState({ buildingNo: "", street: "", district: "", city: "", postalCode: "" });
  const setAddressField = (key) => (e) => setAddress((prev) => ({ ...prev, [key]: e.target.value }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!name.trim()) { setError(t("sales.newCustomerModal.errNameRequired")); return; }
    setSaving(true);
    setError("");
    try {
      const customer = await createCustomer({
        companyId, name: name.trim(), customerType: vatNumber ? "business" : "individual",
        vatNumber: vatNumber || undefined, phone: phone || undefined, email: email || undefined,
        ...(vatNumber ? Object.fromEntries(Object.entries(address).map(([k, v]) => [k, v.trim() || undefined])) : {}),
      });
      onCreated(customer);
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
          <h3>{t("sales.newCustomerModal.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label={t("sales.newCustomerModal.close")}>×</button>
        </div>
        <div className="form-grid">
          <label>{t("sales.newCustomerModal.name")}<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label>{t("sales.newCustomerModal.vatNumber")}<input type="text" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} /></label>
          <label>{t("sales.newCustomerModal.phone")}<input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label>{t("sales.newCustomerModal.email")}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        </div>
        {vatNumber && (
          <>
            <p className="note">{t("sales.customers.addressRequiredForVat")}</p>
            <div className="form-grid">
              <label>{t("sales.customers.addressBuilding")}<input type="text" inputMode="numeric" maxLength={4} value={address.buildingNo} onChange={setAddressField("buildingNo")} /></label>
              <label>{t("sales.customers.addressStreet")}<input type="text" value={address.street} onChange={setAddressField("street")} /></label>
              <label>{t("sales.customers.addressDistrict")}<input type="text" value={address.district} onChange={setAddressField("district")} /></label>
              <label>{t("sales.customers.city")}<input type="text" value={address.city} onChange={setAddressField("city")} /></label>
              <label>{t("sales.customers.addressPostalCode")}<input type="text" inputMode="numeric" maxLength={5} value={address.postalCode} onChange={setAddressField("postalCode")} /></label>
            </div>
          </>
        )}
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>{t("sales.newCustomerModal.cancel")}</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t("sales.newCustomerModal.saving") : t("sales.newCustomerModal.save")}</button>
        </div>
      </div>
    </div>
  );
}
