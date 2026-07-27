import React, { useState } from "react";
import { unpostSalesInvoice } from "../../api/salesInvoices";
import UnpostModal from "../shared/UnpostModal";

/**
 * تحذير حاجز يظهر عند محاولة تعديل أو حذف فاتورة مرحّلة — يوفّر زر "فك الترحيل" مباشرةً
 * داخل نفس التنبيه بدل إجبار المستخدم على الخروج والبحث عن الأيقونة في صف الإجراءات.
 */
export default function PostedBlockModal({ invoiceId, invoiceNumber, action, onClose, onUnposted }) {
  const [showUnpost, setShowUnpost] = useState(false);

  const confirmUnpost = async (pin) => {
    const updated = await unpostSalesInvoice(invoiceId, pin);
    onUnposted(updated);
  };

  if (showUnpost) {
    return (
      <UnpostModal
        title={`فك ترحيل الفاتورة ${invoiceNumber}`}
        onCancel={() => setShowUnpost(false)}
        onConfirm={confirmUnpost}
      />
    );
  }

  return (
    <div className="unpost-confirm-overlay">
      <div className="unpost-confirm-box">
        <h3>لازم تفك ترحيل الفاتورة أولاً</h3>
        <p className="note">
          الفاتورة {invoiceNumber} مرحّلة، ولا يمكن {action} إلا بعد فك ترحيلها. بعد فك الترحيل ستتحول الفاتورة
          إلى مسودة ويُحذف القيد المحاسبي المرتبط بها، وعندها فقط يمكنك {action}.
        </p>
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" onClick={() => setShowUnpost(true)}>فك الترحيل</button>
        </div>
      </div>
    </div>
  );
}
