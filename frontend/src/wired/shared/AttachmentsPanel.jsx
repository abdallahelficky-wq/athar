import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAttachments, uploadAttachment, deleteAttachment } from "../../api/attachments";
import { formatDate } from "../../i18n/dateFormat";

/**
 * مكوّن المرفقات القابل لإعادة الاستخدام — يُدرَج داخل شاشة عرض/تعديل أي معاملة تدعم
 * الأرشفة الإلكترونية (قيد يومية، فاتورة مبيعات، مردود، سند قبض، فاتورة مشتريات، مردود
 * مشتريات، كشف رواتب، تسوية إجازة، أصل ثابت). entityId فارغ/غير موجود (معاملة لم تُحفظ بعد)
 * يعطّل الرفع بلا خطأ، حتى يمكن وضع المكوّن في نماذج الإنشاء قبل الحفظ الأول بأمان.
 */
export default function AttachmentsPanel({ entityType, entityId, title }) {
  const { t, i18n } = useTranslation();
  const formatBytes = (bytes) => {
    if (!bytes) return t("attachments.sizeKb", { size: 0 });
    const kb = bytes / 1024;
    if (kb < 1024) return t("attachments.sizeKb", { size: kb.toFixed(0) });
    return t("attachments.sizeMb", { size: (kb / 1024).toFixed(1) });
  };

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
    if (!window.confirm(t("attachments.confirmDelete", { name: a.fileName }))) return;
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
        <h3 style={{ margin: 0 }}>{title || t("attachments.title")}</h3>
        <div>
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" hidden onChange={onFilePicked} />
          <button
            className="btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={!entityId || uploading}
            title={!entityId ? t("attachments.saveFirstTooltip") : undefined}
          >
            {uploading ? t("attachments.uploading") : t("attachments.addBtn")}
          </button>
        </div>
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {!entityId && <p className="note">{t("attachments.saveFirstNote")}</p>}

      {entityId && (
        loading ? <p className="empty">{t("common.loading")}</p> : (
          <table className="ledger-table">
            <thead><tr><th>{t("attachments.table.file")}</th><th>{t("attachments.table.size")}</th><th>{t("attachments.table.uploadDate")}</th><th></th></tr></thead>
            <tbody>
              {attachments.map((a) => (
                <tr key={a.id}>
                  <td><a href={a.fileUrl} target="_blank" rel="noreferrer">{a.fileName}</a></td>
                  <td className="num">{formatBytes(a.fileSize)}</td>
                  <td>{formatDate(a.uploadedAt, i18n.language)}</td>
                  <td className="row-actions">
                    <a className="btn-ghost" href={a.fileUrl} target="_blank" rel="noreferrer">{t("attachments.download")}</a>
                    <button className="btn-ghost" onClick={() => remove(a)}>{t("common.delete")}</button>
                  </td>
                </tr>
              ))}
              {attachments.length === 0 && <tr><td className="empty" colSpan={4}>{t("attachments.empty")}</td></tr>}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}
