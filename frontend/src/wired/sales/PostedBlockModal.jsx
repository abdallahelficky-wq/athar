import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { unpostSalesInvoice } from "../../api/salesInvoices";
import UnpostModal from "../shared/UnpostModal";

/**
 * تحذير حاجز يظهر عند محاولة تعديل أو حذف فاتورة مرحّلة — يوفّر زر "فك الترحيل" مباشرةً
 * داخل نفس التنبيه بدل إجبار المستخدم على الخروج والبحث عن الأيقونة في صف الإجراءات.
 */
export default function PostedBlockModal({ invoiceId, invoiceNumber, action, onClose, onUnposted }) {
  const { t } = useTranslation();
  const [showUnpost, setShowUnpost] = useState(false);

  const confirmUnpost = async (pin) => {
    const updated = await unpostSalesInvoice(invoiceId, pin);
    onUnposted(updated);
  };

  if (showUnpost) {
    return (
      <UnpostModal
        title={t("sales.postedBlockModal.unpostTitle", { number: invoiceNumber })}
        onCancel={() => setShowUnpost(false)}
        onConfirm={confirmUnpost}
      />
    );
  }

  return (
    <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="unpost-confirm-box">
        <div className="modal-title-row">
          <h3>{t("sales.postedBlockModal.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t("sales.postedBlockModal.close")}>×</button>
        </div>
        <p className="note">
          {t("sales.postedBlockModal.message", { number: invoiceNumber, action })}
        </p>
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose}>{t("sales.postedBlockModal.cancel")}</button>
          <button className="btn-primary" onClick={() => setShowUnpost(true)}>{t("sales.postedBlockModal.unpost")}</button>
        </div>
      </div>
    </div>
  );
}
