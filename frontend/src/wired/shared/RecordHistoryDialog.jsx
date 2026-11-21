import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../../api/http";
import { formatDateTime } from "../../i18n/dateFormat";
import FormDialog from "./FormDialog";

/**
 * «سجل التعديلات» لمستند/سجل: من فعل ماذا ومتى، والحقول التي تغيّرت من/إلى — من مسار الخادم `<المورد>/:id/history`
 * (lib/recordHistory.ts، صفوف audit_logs التي يكتبها مُشغِّل record_row_change وغيره). يُفتح من PrintShell (historyPath)
 * أو من أي شاشة تمرّر المسار نفسه.
 */
const KNOWN_SUFFIXES = ["created", "updated", "deleted", "line_added", "line_updated", "line_deleted", "post", "unpost", "imported_from_zatca"];
const HIDDEN_FIELDS = new Set(["id", "tenantId", "companyId", "invoiceId", "returnId", "debitNoteId", "lineNo"]);

const show = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s;
};

export function RecordHistoryButton({ path, className = "btn-ghost" }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!path) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{t("history.button")}</button>
      {open && <RecordHistoryDialog path={path} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function RecordHistoryDialog({ path, onClose }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api.get(path).then(setRows).catch((e) => setError(e.message)); }, [path]);

  const actionLabel = (action) => {
    const suffix = action.slice(action.indexOf(".") + 1);
    return KNOWN_SUFFIXES.includes(suffix) ? t(`history.actions.${suffix}`) : action;
  };
  const field = (key) => t(`history.fields.${key}`, { defaultValue: key });

  return createPortal(
    <div className="no-print">
      <FormDialog open title={t("history.title")} onClose={onClose}>
        {error && <p className="balance-bad">{error}</p>}
        {!rows && !error && <p className="vat-note">…</p>}
        {rows && rows.length === 0 && <p className="vat-note">{t("history.empty")}</p>}
        {rows && rows.length > 0 && (
          <table className="ledger-table">
            <thead><tr><th>{t("history.when")}</th><th>{t("history.who")}</th><th>{t("history.what")}</th><th>{t("history.details")}</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const m = r.metadata || {};
                const changes = m.changes ? Object.entries(m.changes).filter(([k]) => !HIDDEN_FIELDS.has(k)) : [];
                const snapshot = m.after || m.before;
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(new Date(r.createdAt), i18n.language)}</td>
                    <td>{r.actorName || t("history.unrecorded")}</td>
                    <td>{actionLabel(r.action)}</td>
                    <td>
                      {changes.map(([k, v]) => (
                        <div key={k}><strong>{field(k)}</strong>: {show(v?.from)} {i18n.language === "en" ? "→" : "←"} {show(v?.to)}</div>
                      ))}
                      {!changes.length && snapshot && (
                        <div className="vat-note">
                          {Object.entries(snapshot).filter(([k, v]) => !HIDDEN_FIELDS.has(k) && v !== null && v !== "" && !k.startsWith("zatca")).slice(0, 8).map(([k, v]) => `${field(k)}: ${show(v)}`).join(" · ")}
                        </div>
                      )}
                      {m.reason && <div className="vat-note">{String(m.reason)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </FormDialog>
    </div>,
    document.body,
  );
}
