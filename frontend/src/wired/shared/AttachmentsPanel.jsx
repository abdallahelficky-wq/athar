import React, { useEffect, useRef, useState } from "react";
import { listAttachments, uploadAttachment, deleteAttachment } from "../../api/attachments";

function formatBytes(bytes) {
  if (!bytes) return "0 كيلوبايت";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} كيلوبايت`;
  return `${(kb / 1024).toFixed(1)} ميجابايت`;
}

/**
 * مكوّن المرفقات القابل لإعادة الاستخدام — يُدرَج داخل شاشة عرض/تعديل أي معاملة تدعم
 * الأرشفة الإلكترونية (قيد يومية، فاتورة مبيعات، مردود، سند قبض، فاتورة مشتريات، مردود
 * مشتريات، كشف رواتب، تسوية إجازة، أصل ثابت). entityId فارغ/غير موجود (معاملة لم تُحفظ بعد)
 * يعطّل الرفع بلا خطأ، حتى يمكن وضع المكوّن في نماذج الإنشاء قبل الحفظ الأول بأمان.
 */
export default function AttachmentsPanel({ entityType, entityId, title = "المرفقات" }) {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const reload = () => {
    if (!entityId) return;
    setLoading(true);
    listAttachments(entityType, entityId)
      .then(setAttachments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [entityType, entityId]);

  const onFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !entityId) return;
    setUploading(true);
    setError("");
    try {
      await uploadAttachment(entityType, entityId, file);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (a) => {
    if (!window.confirm(`حذف المرفق "${a.fileName}"؟`)) return;
    try {
      await deleteAttachment(a.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="panel form-panel attachments-panel">
      <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div>
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" hidden onChange={onFilePicked} />
          <button
            className="btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={!entityId || uploading}
            title={!entityId ? "احفظ المعاملة أولاً قبل إرفاق مستندات" : undefined}
          >
            {uploading ? "جارٍ الرفع..." : "+ إرفاق مستند"}
          </button>
        </div>
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {!entityId && <p className="note">احفظ المعاملة أولاً لتتمكّن من إرفاق مستندات بها.</p>}

      {entityId && (
        loading ? <p className="empty">جارٍ التحميل...</p> : (
          <table className="ledger-table">
            <thead><tr><th>الملف</th><th>الحجم</th><th>تاريخ الرفع</th><th></th></tr></thead>
            <tbody>
              {attachments.map((a) => (
                <tr key={a.id}>
                  <td><a href={a.fileUrl} target="_blank" rel="noreferrer">{a.fileName}</a></td>
                  <td className="num">{formatBytes(a.fileSize)}</td>
                  <td>{new Date(a.uploadedAt).toLocaleDateString("ar-SA")}</td>
                  <td className="row-actions">
                    <a className="btn-ghost" href={a.fileUrl} target="_blank" rel="noreferrer">تنزيل</a>
                    <button className="btn-ghost" onClick={() => remove(a)}>حذف</button>
                  </td>
                </tr>
              ))}
              {attachments.length === 0 && <tr><td className="empty" colSpan={4}>لا توجد مستندات مرفقة بعد.</td></tr>}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
