import React, { useState } from "react";
import * as XLSX from "xlsx";
import { previewBulkImportJournalEntries, commitBulkImportJournalEntries } from "../../api/journalEntries";
import { listAccounts, createAccount } from "../../api/accounts";
import AccountSearchSelect from "./AccountSearchSelect";

/**
 * استيراد قيود يومية بالجملة من ملف Excel/CSV — ميزة عامة قابلة لإعادة الاستخدام لأي عملية ترحيل
 * بيانات تاريخية من نظام قديم، وليست خاصة بشركة بعينها. تتكوّن من ثلاث خطوات:
 * 1) رفع الملف وتطبيعه محلياً (نفس أسلوب ExcelImportPanel لكن بأعمدة أكثر ومطابقة أعمدة مرنة).
 * 2) مراجعة: كل اسم حساب فريد بالملف يُقارَن بأسماء حسابات الترحيل الفعلية في شجرة الشركة —
 *    "متطابق" تلقائياً (مطابقة نصية دقيقة واحدة)، "غير مؤكد" (أكثر من حساب بنفس الاسم)، أو
 *    "غير متطابق" (لا يوجد) — وفي الحالتين الأخيرتين يختار المستخدم الحساب الصحيح يدوياً من الشجرة
 *    الفعلية، أو يُنشئ حساباً جديداً في مكانه مباشرة إن لم يكن موجوداً أصلاً.
 * 3) تأكيد الاستيراد: كل الأسطر التي تشترك في نفس "رقم القيد التسلسلي" تُجمَّع في قيد يومية واحد،
 *    وتُحفَظ كل القيود بحالة "محفوظ" (غير مرحّلة) لمراجعتها والترحيل اليدوي لاحقاً من شاشة القيود.
 */

const EXPECTED_COLUMNS = {
  groupKey: ["رقم القيد التسلسلي (للتجميع فقط)", "رقم القيد التسلسلي", "رقم القيد"],
  date: ["التاريخ"],
  memo: ["البيان"],
  accountName: ["اسم الحساب"],
  debit: ["مدين"],
  credit: ["دائن"],
  note: ["ملاحظة"],
};

const STATUS_LABEL = { matched: "متطابق تلقائياً", ambiguous: "غير مؤكد (أكثر من حساب بنفس الاسم)", unmatched: "غير متطابق" };
const STATUS_CLASS = { matched: "matched", ambiguous: "ambiguous", unmatched: "unmatched" };

function normalizeDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return String(v ?? "").trim();
}

function normalizeRows(sheetRows) {
  if (!sheetRows.length) throw new Error("الملف فارغ");
  const headers = Object.keys(sheetRows[0]);
  const resolveHeader = (candidates) => headers.find((h) => candidates.some((c) => h.trim() === c));
  const columnByField = {};
  for (const [field, candidates] of Object.entries(EXPECTED_COLUMNS)) {
    const found = resolveHeader(candidates);
    if (!found) throw new Error(`العمود المطلوب غير موجود في الملف: "${candidates[0]}"`);
    columnByField[field] = found;
  }
  return sheetRows
    .map((r) => ({
      groupKey: String(r[columnByField.groupKey] ?? "").trim(),
      date: normalizeDate(r[columnByField.date]),
      memo: String(r[columnByField.memo] ?? "").trim(),
      accountName: String(r[columnByField.accountName] ?? "").trim(),
      debit: Number(r[columnByField.debit] || 0),
      credit: Number(r[columnByField.credit] || 0),
      note: String(r[columnByField.note] ?? "").trim(),
    }))
    .filter((r) => r.groupKey && r.accountName);
}

const ACCOUNT_TYPES = [
  { value: "asset", label: "أصل" },
  { value: "liability", label: "التزام" },
  { value: "equity", label: "حقوق ملكية" },
  { value: "revenue", label: "إيراد" },
  { value: "expense", label: "مصروف" },
];

function NewAccountInlineForm({ companyId, suggestedName, parentGroups, onCreated, onCancel }) {
  const [name, setName] = useState(suggestedName);
  const [type, setType] = useState("asset");
  const [parentId, setParentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!name.trim() || !parentId) { setError("اختر المجموعة الأب وأدخل الاسم"); return; }
    setSaving(true);
    setError("");
    try {
      const account = await createAccount({ name: name.trim(), type, companyId, parentId });
      onCreated(account);
    } catch (err) {
      setError(err.message || "تعذّر إنشاء الحساب");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bulk-import-new-account">
      <div className="form-grid" style={{ gridTemplateColumns: "1.4fr 0.8fr 1.4fr auto auto" }}>
        <label>اسم الحساب<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>
          النوع
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label>
          تحت مجموعة (مستوى 3)
          <AccountSearchSelect accounts={parentGroups} value={parentId} onChange={setParentId} />
        </label>
        <div style={{ alignSelf: "end" }}>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? "جارٍ الإنشاء..." : "إنشاء"}</button>
        </div>
        <div style={{ alignSelf: "end" }}>
          <button className="btn-ghost" onClick={onCancel} disabled={saving}>إلغاء</button>
        </div>
      </div>
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}

export default function BulkImportJournalEntriesModal({ companyId, onClose, onImported }) {
  const [step, setStep] = useState("upload"); // upload | review | done
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [postingAccounts, setPostingAccounts] = useState([]);
  const [parentGroups, setParentGroups] = useState([]);
  const [creatingFor, setCreatingFor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError("");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const sheetRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const normalized = normalizeRows(sheetRows);
        setRows(normalized);
        setLoading(true);
        const [previewResult, tree] = await Promise.all([
          previewBulkImportJournalEntries(companyId, normalized),
          listAccounts({ companyId, tree: true }),
        ]);
        setPreview(previewResult);
        setPostingAccounts(tree.filter((a) => a.isPosting));
        setParentGroups(tree.filter((a) => a.level === 3));
        const initialMapping = {};
        previewResult.accountNames.forEach((a) => { if (a.status === "matched") initialMapping[a.name] = a.matchedAccountId; });
        setMapping(initialMapping);
        setStep("review");
      } catch (err) {
        setError(err.message || "تعذّرت قراءة الملف");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const setAccountFor = (name, accountId) => setMapping((m) => ({ ...m, [name]: accountId }));

  const onAccountCreated = (name, account) => {
    setPostingAccounts((list) => [...list, account]);
    setAccountFor(name, account.id);
    setCreatingFor(null);
  };

  const allResolved = preview ? preview.accountNames.every((a) => mapping[a.name]) : false;

  const submit = async () => {
    setCommitting(true);
    setError("");
    try {
      const commitResult = await commitBulkImportJournalEntries(companyId, rows, mapping);
      const autoMatched = preview.accountNames.filter((a) => a.status === "matched").length;
      const manuallyResolved = preview.accountNames.length - autoMatched;
      setResult({ ...commitResult, totalGroups: preview.totalGroups, autoMatched, manuallyResolved });
      setStep("done");
      onImported?.();
    } catch (err) {
      setError(err.message || "فشل الاستيراد");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay" onClick={(e) => e.target === e.currentTarget && !committing && onClose()}>
      <div className="unpost-confirm-box from-document-box">
        <div className="modal-title-row">
          <h3>استيراد قيود يومية بالجملة</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={committing} aria-label="إغلاق">×</button>
        </div>

        {step === "upload" && (
          <>
            <p className="note">
              ارفع ملف Excel أو CSV يحتوي الأعمدة: "رقم القيد التسلسلي (للتجميع)"، "التاريخ"، "البيان"، "اسم الحساب"،
              "مدين"، "دائن"، "ملاحظة" (اختياري). تُجمَّع كل الأسطر التي تشترك في نفس رقم القيد في قيد واحد، وتُحفَظ
              كل القيود المستوردة بحالة "محفوظ" لمراجعتها وترحيلها يدوياً.
            </p>
            <label className="btn-primary file-upload-btn">
              رفع ملف
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
            </label>
            {loading && <p className="note">جارٍ تحليل الملف ومطابقة الحسابات...</p>}
            {error && <p className="balance-bad">{error}</p>}
          </>
        )}

        {step === "review" && preview && (
          <>
            <p className="note">
              {preview.totalRows} سطر ضمن {preview.totalGroups} قيد. راجع مطابقة الحسابات أدناه قبل التأكيد.
            </p>
            {preview.unbalancedGroups.length > 0 && (
              <div className="balance-bad" style={{ marginBottom: 10 }}>
                تحذير: {preview.unbalancedGroups.length} قيد غير متوازن (مدين ≠ دائن) ولن يمكن استيراده — أول قيد غير
                متوازن: رقم {preview.unbalancedGroups[0].groupKey} ({preview.unbalancedGroups[0].date}).
              </div>
            )}
            <div className="lines-table-wrap">
              <table className="lines-table">
                <thead>
                  <tr><th>اسم الحساب في الملف</th><th>عدد الأسطر</th><th>الحالة</th><th>الحساب في شجرة الشركة</th></tr>
                </thead>
                <tbody>
                  {preview.accountNames.map((a) => (
                    <React.Fragment key={a.name}>
                      <tr>
                        <td>{a.name}</td>
                        <td className="num">{a.occurrences}</td>
                        <td><span className={`bulk-match-badge ${STATUS_CLASS[a.status]}`}>{STATUS_LABEL[a.status]}</span></td>
                        <td>
                          <div className="form-btn-group" style={{ flexWrap: "nowrap" }}>
                            <AccountSearchSelect
                              accounts={postingAccounts}
                              value={mapping[a.name] || ""}
                              onChange={(id) => setAccountFor(a.name, id)}
                              placeholder="اختر حساباً..."
                            />
                            <button className="btn-ghost" onClick={() => setCreatingFor(creatingFor === a.name ? null : a.name)}>
                              + حساب جديد
                            </button>
                          </div>
                        </td>
                      </tr>
                      {creatingFor === a.name && (
                        <tr>
                          <td colSpan={4}>
                            <NewAccountInlineForm
                              companyId={companyId}
                              suggestedName={a.name}
                              parentGroups={parentGroups}
                              onCreated={(account) => onAccountCreated(a.name, account)}
                              onCancel={() => setCreatingFor(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={onClose} disabled={committing}>إلغاء</button>
              <button
                className="btn-primary"
                onClick={submit}
                disabled={committing || !allResolved || preview.unbalancedGroups.length > 0}
              >
                {committing ? "جارٍ الاستيراد..." : `تأكيد استيراد ${preview.totalGroups} قيد`}
              </button>
            </div>
            {!allResolved && <p className="note">اربط كل الحسابات أعلاه (اختر حساباً موجوداً أو أنشئ حساباً جديداً) قبل المتابعة.</p>}
          </>
        )}

        {step === "done" && result && (
          <>
            <p className="note">
              تم الاستيراد بنجاح. القيود محفوظة بحالة "محفوظ" (غير مرحّلة) — راجعها من شاشة القيود ورحّلها يدوياً.
            </p>
            <div className="lines-table-wrap">
              <table className="lines-table">
                <tbody>
                  <tr><td className="foot-label">عدد القيود المستوردة</td><td className="num strong">{result.importedEntries}</td></tr>
                  <tr><td className="foot-label">عدد الأسطر المستوردة</td><td className="num strong">{result.importedLines}</td></tr>
                  <tr><td className="foot-label">حسابات تطابقت تلقائياً</td><td className="num strong">{result.autoMatched}</td></tr>
                  <tr><td className="foot-label">حسابات احتاجت ربطاً يدوياً</td><td className="num strong">{result.manuallyResolved}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="form-btn-group">
              <button className="btn-primary" onClick={onClose}>إغلاق</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
