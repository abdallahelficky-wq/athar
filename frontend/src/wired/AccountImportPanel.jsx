import React, { useRef, useState } from "react";
import { importAccounts } from "../api/accounts";
import { parseAccountWorkbook } from "./accountImport";

export default function AccountImportPanel({ scope, accounts, onImported }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    setFileName(file.name);
    try {
      setPreview(parseAccountWorkbook(await file.arrayBuffer(), accounts));
    } catch (error) {
      setPreview(null);
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
      setMessage(`تم استيراد ${result.imported} حساب بنجاح`);
      setPreview(null);
      setFileName("");
      onImported();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>استيراد شجرة الحسابات من Excel</strong>
          <div className="note">يدعم XLS وXLSX ويعرض الأخطاء قبل حفظ أي حساب.</div>
        </div>
        <div className="form-btn-group">
          <input ref={inputRef} type="file" accept=".xls,.xlsx" hidden onChange={chooseFile} />
          <button className="btn-ghost" onClick={() => inputRef.current?.click()}>اختيار ملف Excel</button>
          {preview && (
            <button className="btn-primary" disabled={busy || preview.errorCount > 0} onClick={submit}>
              {busy ? "جارٍ الاستيراد..." : `استيراد ${preview.rows.length} حساب`}
            </button>
          )}
        </div>
      </div>

      {message && <p className={message.startsWith("تم ") ? "balance-good" : "balance-bad"}>{message}</p>}
      {preview && (
        <>
          <p className={preview.errorCount ? "balance-bad" : "balance-good"}>
            الملف: {fileName} — الورقة: {preview.sheetName} — الحسابات: {preview.rows.length}
            {preview.errorCount ? ` — يحتاج مراجعة: ${preview.errorCount}` : " — جاهز للاستيراد"}
          </p>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <table className="ledger-table">
              <thead><tr><th>الكود</th><th>الاسم العربي</th><th>الاسم الإنجليزي</th><th>المستوى</th><th>الأب</th><th>التصنيف</th><th>الحالة</th></tr></thead>
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
                      {row.errors.length ? row.errors.join("، ") : "جاهز"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 100 && <p className="note">تظهر أول 100 نتيجة في المعاينة، وسيتم فحص جميع الصفوف.</p>}
        </>
      )}
    </div>
  );
}
