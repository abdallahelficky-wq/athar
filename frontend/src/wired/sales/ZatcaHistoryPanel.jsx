import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadBlob } from "../../legacy/shared";
import { formatDateTime } from "../../i18n/dateFormat";
import { getZatcaHistory, getZatcaAttemptXmlBlob, reissueRejectedZatcaDocument } from "../../api/zatcaHistory";
import { zatcaHistoryView } from "./zatcaHistoryState";

/**
 * سجل زاتكا لمستند واحد: كل إصدار (UUID/ICV — لا يُعاد استخدام أيٍّ منهما) وكل محاولة إرسال بنتيجتها وملف XML الموقَّع كما أُرسِل.
 * وزر "إعادة إصدار المستند المصحَّح" لمستند قياسي رفضته زاتكا فقط: نفس الرقم، UUID/ICV جديدان، تاريخ إصدار جديد، وتاريخ
 * التوريد يبقى تاريخ المستند الأصلي (راجع src/lib/zatca/reissue.ts). الخادم يتحقّق من كل الشروط والصلاحية من جديد.
 */
export default function ZatcaHistoryPanel({ basePath, document, onReissued, notify }) {
  const { t, i18n } = useTranslation();
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // الخطأ لا يُبتلَع: كان catch يضع قائمتين فارغتين فتختفي اللوحة أو تبدو فارغة بلا أي تفسير
  const load = () => {
    setLoading(true);
    return getZatcaHistory(basePath, document.id)
      .then((h) => { setHistory(h); setError(null); })
      .catch((err) => setError({ status: err?.status, message: err?.message }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [basePath, document.id, document.zatcaUuid, document.zatcaStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = zatcaHistoryView({ loading, error, history, zatcaStatus: document.zatcaStatus });

  const download = async (attempt) => {
    try {
      const blob = await getZatcaAttemptXmlBlob(basePath, document.id, attempt.id);
      downloadBlob(blob, `ICV${attempt.icv}_${attempt.documentUuid}.xml`);
    } catch (err) {
      notify?.(err.message, "error");
    }
  };

  const reissue = async () => {
    setBusy(true);
    try {
      const updated = await reissueRejectedZatcaDocument(basePath, document.id);
      setConfirming(false);
      onReissued?.(updated);
      await load();
    } catch (err) {
      notify?.(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const fmtTime = (v) => (v ? formatDateTime(v, i18n.language) : "—");
  return (
    <section className="no-print" style={{ padding: 16, marginBottom: 16, border: "1px solid #ddd", borderRadius: 8 }}>
      <h4 style={{ marginTop: 0 }}>{t("zatcaHistory.title")}</h4>
      {view.kind === "loading" && <p role="status">{t("zatcaHistory.loading")}</p>}
      {view.kind === "error" && (
        <p role="alert" style={{ color: "#b42318" }}>
          {view.status ? t("zatcaHistory.loadErrorWithStatus", { status: view.status }) : t("zatcaHistory.loadErrorNetwork")}
          {view.message ? <>: <span dir="auto">{view.message}</span></> : null}{" "}
          <button type="button" className="btn-link" onClick={load}>{t("zatcaHistory.retryLoad")}</button>
        </p>
      )}
      {view.kind === "empty" && <p>{t("zatcaHistory.empty")}</p>}
      {view.reissueBlockedReason && <p style={{ color: "#8a6100" }}><span dir="auto">{view.reissueBlockedReason}</span></p>}
      {view.showReissue && (
        <div style={{ marginBottom: 12 }}>
          {!confirming ? (
            <button type="button" className="btn-primary" onClick={() => setConfirming(true)}>{t("zatcaHistory.reissue")}</button>
          ) : (
            <div style={{ padding: 12, background: "#fff8e1", borderRadius: 6 }}>
              <p style={{ marginTop: 0 }}>{t("zatcaHistory.reissueConfirm")}</p>
              <button type="button" className="btn-primary" disabled={busy} onClick={reissue}>
                {busy ? t("salesInvoices.zatcaSummary.sending") : t("zatcaHistory.reissueConfirmButton")}
              </button>{" "}
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>{t("zatcaHistory.cancel")}</button>
            </div>
          )}
        </div>
      )}
      {view.kind === "data" && view.issues.length > 0 && (
        <div className="table-responsive">
          <table className="table">
            <thead><tr><th>ICV</th><th>UUID</th><th>{t("zatcaHistory.issuedAt")}</th><th>{t("zatcaHistory.supplyDate")}</th><th>{t("zatcaHistory.source")}</th></tr></thead>
            <tbody>
              {view.issues.map((i) => (
                <tr key={i.id} style={i.documentUuid === document.zatcaUuid ? { fontWeight: 600 } : undefined}>
                  <td data-label="ICV">{i.icv}</td>
                  <td data-label="UUID"><bdi style={{ overflowWrap: "anywhere" }}>{i.documentUuid}</bdi></td>
                  <td data-label={t("zatcaHistory.issuedAt")}>{fmtTime(i.issuedAt)}</td>
                  <td data-label={t("zatcaHistory.supplyDate")}>{i.supplyDate || "—"}</td>
                  <td data-label={t("zatcaHistory.source")}>{t(`zatcaHistory.issueSource.${i.source}`, { defaultValue: i.source })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.kind === "data" && view.attempts.length > 0 && (
        <div className="table-responsive">
          <table className="table">
            <thead><tr><th>{t("zatcaHistory.attemptedAt")}</th><th>ICV</th><th>{t("zatcaHistory.outcome")}</th><th>HTTP</th><th>{t("zatcaHistory.reason")}</th><th>XML</th></tr></thead>
            <tbody>
              {view.attempts.map((a) => (
                <tr key={a.id}>
                  <td data-label={t("zatcaHistory.attemptedAt")}>{fmtTime(a.attemptedAt)}</td>
                  <td data-label="ICV">{a.icv}</td>
                  <td data-label={t("zatcaHistory.outcome")}>{t(`salesInvoices.zatcaStatus.${a.outcome}`, { defaultValue: a.outcome })}</td>
                  <td data-label="HTTP">{a.httpStatus ?? "—"}</td>
                  <td data-label={t("zatcaHistory.reason")}><span dir="auto" style={{ overflowWrap: "anywhere" }}>{a.reason || "—"}</span></td>
                  <td data-label="XML">
                    {a.hasSignedXml
                      ? <button type="button" className="btn-link" onClick={() => download(a)}>{t("zatcaHistory.download")}</button>
                      : <span title={t("zatcaHistory.noXmlHint")}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
