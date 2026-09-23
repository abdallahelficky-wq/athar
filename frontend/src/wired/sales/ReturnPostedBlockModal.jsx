import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { unpostSalesReturn } from "../../api/salesReturns";
import UnpostModal from "../shared/UnpostModal";

/**
 * تحذير حاجز يظهر عند محاولة تعديل أو حذف إشعار دائن مرحّل — نفس PostedBlockModal.jsx بالضبط
 * (راجعه)، بفرق واحد: يستدعي unpostSalesReturn لا unpostSalesInvoice.
 */
export default function ReturnPostedBlockModal({ returnId, returnNumber, action, onClose, onUnposted }) {
  const { t } = useTranslation();
  const [showUnpost, setShowUnpost] = useState(false);

  const confirmUnpost = async (pin) => {
    const updated = await unpostSalesReturn(returnId, pin);
    onUnposted(updated);
  };

  if (showUnpost) {
    return (
      <UnpostModal
        title={t("sales.returns.postedBlockModal.unpostTitle", { number: returnNumber })}
        onCancel={() => setShowUnpost(false)}
        onConfirm={confirmUnpost}
      />
    );
  }

  return (
    <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="unpost-confirm-box">
        <div className="modal-title-row">
          <h3>{t("sales.returns.postedBlockModal.title")}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t("sales.returns.postedBlockModal.close")}>×</button>
        </div>
        <p className="note">{t("sales.returns.postedBlockModal.message", { number: returnNumber, action })}</p>
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose}>{t("sales.returns.postedBlockModal.cancel")}</button>
          <button className="btn-primary" onClick={() => setShowUnpost(true)}>{t("sales.returns.postedBlockModal.unpost")}</button>
        </div>
      </div>
    </div>
  );
}
