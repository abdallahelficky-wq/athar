import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { importAccounts } from "../api/accounts";
import { parseAccountWorkbook } from "./accountImport";

export default function AccountImportPanel({ scope, accounts, onImported }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);

  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    setFileName(file.name);
    try {
      setPreview(parseAccountWorkbook(await file.arrayBuffer(), accounts));
    } catch (error) {
      setPreview(null);
      setMessageOk(false);
      setMessage(error.message);
    } finally {
      event.target.value = "";
    }
  };

  const submit = async () => {
    if (!preview || preview.errorCount) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await importAccounts({
        companyId: scope === "group" ? null : scope,
        rows: preview.rows.map(({ code, name, nameEn, type, level, isPosting, parentCode, isBankOrCash }) => ({
          code, name, nameEn, type, level, isPosting, parentCode, isBankOrCash,
        })),
      });
      setMessageOk(true);
      setMessage(t("chartOfAccounts.import.success", { count: result.imported }));
      setPreview(null);
      setFileName("");
      onImported();
    } catch (error) {
      setMessageOk(false);
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>{t("chartOfAccounts.import.title")}</strong>
          <div className="note">{t("chartOfAccounts.import.subtitle")}</div>
        </div>
        <div className="form-btn-group">
          <input ref={inputRef} type="file" accept=".xls,.xlsx" hidden onChange={chooseFile} />
          <button className="btn-ghost" onClick={() => inputRef.current?.click()}>{t("chartOfAccounts.import.chooseFile")}</button>
          {preview && (
            <button className="btn-primary" disabled={busy || preview.errorCount > 0} onClick={submit}>
              {busy ? t("chartOfAccounts.import.importing") : t("chartOfAccounts.import.importBtn", { count: preview.rows.length })}
            </button>
          )}
        </div>
      </div>

      {message && <p className={messageOk ? "balance-good" : "balance-bad"}>{message}</p>}
      {preview && (
        <>
          <p className={preview.errorCount ? "balance-bad" : "balance-good"}>
            {t("chartOfAccounts.import.summary", { fileName, sheetName: preview.sheetName, count: preview.rows.length })}
            {preview.errorCount ? t("chartOfAccounts.import.needsReview", { count: preview.errorCount }) : t("chartOfAccounts.import.ready")}
          </p>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <table className="ledger-table">
              <thead><tr><th>{t("chartOfAccounts.import.table.code")}</th><th>{t("chartOfAccounts.import.table.nameAr")}</th><th>{t("chartOfAccounts.import.table.nameEn")}</th><th>{t("chartOfAccounts.import.table.level")}</th><th>{t("chartOfAccounts.import.table.parent")}</th><th>{t("chartOfAccounts.import.table.type")}</th><th>{t("chartOfAccounts.import.table.status")}</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 100).map((row, index) => (
                  <tr key={`${row.code}-${index}`}>
                    <td className="num">{row.code}</td>
                    <td>{row.name || "—"}</td>
                    <td>{row.nameEn || "—"}</td>
                    <td>{row.level || "—"}</td>
                    <td className="num">{row.parentCode || "—"}</td>
                    <td>{row.type || "—"}</td>
                    <td className={row.errors.length ? "balance-bad" : "balance-good"}>
                      {row.errors.length ? row.errors.join("، ") : t("chartOfAccounts.import.rowReady")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 100 && <p className="note">{t("chartOfAccounts.import.previewNote")}</p>}
        </>
      )}
    </div>
  );
}
