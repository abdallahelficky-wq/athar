import React, { useEffect, useMemo, useState } from "react";
import { listAccounts } from "../api/accounts";
import { listCostCenters } from "../api/costCenters";
import {
  listJournalEntries,
  getJournalEntry,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  postJournalEntry,
  unpostJournalEntry,
  importJournalEntries,
} from "../api/journalEntries";
import { fmt, fmt2 } from "../legacy/constants";
import { ExcelImportPanel, downloadCsv, Icon } from "../legacy/shared";
import AttachmentsPanel from "./shared/AttachmentsPanel";
import CreateFromDocumentModal from "./shared/CreateFromDocumentModal";
import MirrorEntryModal from "./shared/MirrorEntryModal";
import Breadcrumb from "./shared/Breadcrumb";
import JournalVoucherViewModal from "./JournalVoucherViewModal";

const emptyLine = () => ({ accountId: "", costCenterId: "", department: "", debit: "", credit: "" });

function UnpostModal({ onConfirm, onCancel }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(pin);
    } catch (err) {
      setError(err.message || "الرقم السري غير صحيح");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="unpost-confirm-overlay">
      <div className="unpost-confirm-box">
        <h3>فك ترحيل القيد</h3>
        <p className="note">أدخل الرقم السري لتأكيد فك الترحيل. سيتحقق الخادم من صحته فعلياً.</p>
        <input
          type="password"
          placeholder="الرقم السري"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-ghost" onClick={onCancel} disabled={submitting}>إلغاء</button>
          <button className="btn-primary" onClick={submit} disabled={submitting || !pin}>
            {submitting ? "جارٍ التحقق..." : "تأكيد فك الترحيل"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function JournalModule({ companies, companyId }) {
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [unpostTarget, setUnpostTarget] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [attachmentsFor, setAttachmentsFor] = useState(null);
  const [showFromDocument, setShowFromDocument] = useState(false);
  const [viewEntry, setViewEntry] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [mirrorSource, setMirrorSource] = useState(null);
  const [mirrorInfoId, setMirrorInfoId] = useState(null);
  const [mirrorInfo, setMirrorInfo] = useState(null);
  const [mirrorNotice, setMirrorNotice] = useState("");

  useEffect(() => {
    listAccounts().then(setAccounts).catch((err) => setError(err.message));
    listCostCenters().then(setCostCenters).catch((err) => setError(err.message));
  }, []);

  const reloadEntries = () => {
    if (!companyId) { setEntries([]); setLoading(false); return; }
    setLoading(true);
    listJournalEntries({ companyId })
      .then(setEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(reloadEntries, [companyId]);

  const costCenterOptions = useMemo(
    () => costCenters.filter((c) => !c.companyId || c.companyId === companyId),
    [costCenters, companyId],
  );

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const diff = totalDebit - totalCredit;
  const canPost = lines.filter((l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0).length >= 2
    && totalDebit > 0 && Math.abs(diff) < 0.01;

  const updateLine = (idx, field, value) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx) => setLines((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const resetForm = () => {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setMemo("");
    setLines([emptyLine(), emptyLine()]);
  };

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setDate(entry.date.slice(0, 10));
    setMemo(entry.memo || "");
    setLines(entry.lines.map((l) => ({
      accountId: l.accountId,
      costCenterId: l.costCenterId || "",
      department: l.department || "",
      debit: Number(l.debit) || "",
      credit: Number(l.credit) || "",
    })));
  };

  const submit = async () => {
    if (!canPost || !companyId) return;
    setSaving(true);
    setError("");
    const payload = {
      companyId,
      date,
      memo,
      lines: lines
        .filter((l) => Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)
        .map((l) => ({
          accountId: l.accountId,
          costCenterId: l.costCenterId || null,
          department: l.department || null,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
        })),
    };
    try {
      if (editingId) await updateJournalEntry(editingId, payload);
      else await createJournalEntry(payload);
      resetForm();
      reloadEntries();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry) => {
    if (!window.confirm("حذف هذا القيد نهائياً؟")) return;
    try {
      await deleteJournalEntry(entry.id);
      reloadEntries();
    } catch (err) {
      setError(err.message);
    }
  };

  const doPost = async (entry) => {
    try {
      await postJournalEntry(entry.id);
      reloadEntries();
    } catch (err) {
      setError(err.message);
    }
  };

  const doUnpost = async (pin) => {
    await unpostJournalEntry(unpostTarget.id, pin);
    setUnpostTarget(null);
    reloadEntries();
  };

  const toggleMirrorInfo = async (e) => {
    if (mirrorInfoId === e.id) { setMirrorInfoId(null); setMirrorInfo(null); return; }
    setMirrorInfoId(e.id);
    setMirrorInfo(null);
    try {
      const full = await getJournalEntry(e.id);
      setMirrorInfo(full.mirrorEntry);
    } catch (err) {
      setError(err.message);
    }
  };

  const entryTotal = (e) => e.lines.reduce((s, l) => s + Number(l.debit || 0), 0);

  const filtered = entries.filter((e) => !searchText || (e.memo || "").includes(searchText));

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["دفتر اليومية", "بيانات حقيقية"]} />
        <h2>القيود المحاسبية</h2>
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {mirrorNotice && <p className="balance-ok">{mirrorNotice}</p>}

      {!companyId ? (
        <p className="empty">أنشئ شركة أولاً من لوحة القيادة لبدء تسجيل القيود.</p>
      ) : (
        <>
          <div className="panel form-panel">
            {editingId && <div className="edit-banner">تعديل القيد (فك ترحيله أولاً إن كان مرحّلاً)</div>}
            <div className="form-grid header-grid">
              <label>التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="memo-field">بيان القيد<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="وصف عام للقيد" /></label>
            </div>

            <div className="lines-table-wrap">
              <table className="lines-table">
                <thead>
                  <tr><th>الحساب</th><th>مركز التكلفة</th><th>القسم</th><th>مدين</th><th>دائن</th><th></th></tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx}>
                      <td>
                        <select value={l.accountId} onChange={(e) => updateLine(idx, "accountId", e.target.value)}>
                          <option value="">— اختر —</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={l.costCenterId} onChange={(e) => updateLine(idx, "costCenterId", e.target.value)}>
                          <option value="">— بدون —</option>
                          {costCenterOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td><input type="text" value={l.department} onChange={(e) => updateLine(idx, "department", e.target.value)} placeholder="اختياري" /></td>
                      <td><input type="number" className="amount-input" value={l.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)} placeholder="0.00" /></td>
                      <td><input type="number" className="amount-input" value={l.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)} placeholder="0.00" /></td>
                      <td><button className="btn-remove-line" onClick={() => removeLine(idx)} disabled={lines.length <= 2}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="foot-label" colSpan={3}>الإجمالي</td>
                    <td className="num">{fmt2(totalDebit)}</td>
                    <td className="num">{fmt2(totalCredit)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="journal-actions">
              <button className="btn-ghost" onClick={addLine}>+ إضافة سطر</button>
              <div className="balance-status">
                {diff === 0 && totalDebit > 0 && <span className="balance-ok">✓ القيد متوازن — جاهز للترحيل</span>}
                {diff !== 0 && <span className="balance-bad">الفرق بين المدين والدائن: {fmt2(Math.abs(diff))} ر.س</span>}
              </div>
              <div className="form-btn-group">
                {editingId && <button className="btn-ghost" onClick={resetForm}>إلغاء التعديل</button>}
                <button className="btn-primary" onClick={submit} disabled={!canPost || saving}>
                  {saving ? "جارٍ الحفظ..." : editingId ? "حفظ التعديلات" : "ترحيل القيد"}
                </button>
              </div>
            </div>
          </div>

          <div className="panel form-panel">
            <div className="filter-bar">
              <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="بحث بالبيان" />
              <button className="btn-primary" onClick={() => setShowFromDocument(true)}>
                إنشاء قيد من مستند (ذكاء اصطناعي)
              </button>
              <button
                className="btn-ghost"
                onClick={() => downloadCsv("القيود_اليومية.csv", [
                  ["التاريخ", "البيان", "الحالة", "الإجمالي"],
                  ...filtered.map((e) => [e.date.slice(0, 10), e.memo, e.status, entryTotal(e)]),
                ])}
              >
                تصدير Excel/CSV
              </button>
            </div>
          </div>

          {loading ? (
            <p className="empty">جارٍ التحميل...</p>
          ) : (
            <div className="entries-feed">
              {filtered.slice().reverse().map((e) => (
                <div className="panel entry-card" key={e.id}>
                  <div className="entry-card-head">
                    <div>
                      <span className="entry-memo">{e.memo || "بدون بيان"}</span>
                      <span className="entry-meta"> · {e.date.slice(0, 10)} · {e.status === "posted" ? "مرحّل" : "مسودة"}</span>
                    </div>
                    <span className="entry-total">{fmt(entryTotal(e))} ر.س</span>
                  </div>
                  <table className="ledger-table entry-lines">
                    <thead><tr><th>الحساب</th><th>مركز التكلفة</th><th>القسم</th><th>مدين</th><th>دائن</th></tr></thead>
                    <tbody>
                      {e.lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.account?.name}</td>
                          <td>{l.costCenter?.name || "—"}</td>
                          <td>{l.department || "—"}</td>
                          <td className="num">{Number(l.debit) ? fmt(l.debit) : "—"}</td>
                          <td className="num">{Number(l.credit) ? fmt(l.credit) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="entry-card-actions form-btn-group">
                    <button className="icon-btn" title="عرض القيد" onClick={() => setViewEntry(e)}><Icon.Eye /></button>
                    <button
                      className="icon-btn" title="طباعة القيد"
                      onClick={() => { setViewEntry(e); setAutoPrint(true); }}
                    ><Icon.Printer /></button>
                    {e.status === "draft" && (
                      <>
                        <button className="btn-ghost" onClick={() => startEdit(e)}>تعديل</button>
                        <button className="btn-ghost" onClick={() => remove(e)}>حذف</button>
                        <button className="btn-primary" onClick={() => doPost(e)}>ترحيل</button>
                      </>
                    )}
                    {e.status === "posted" && (
                      <button className="btn-ghost" onClick={() => setUnpostTarget(e)}>فك الترحيل</button>
                    )}
                    {e.status === "posted" && !e.mirrorEntryId && (
                      <button className="icon-btn" title="إنشاء قيد مرآة في شركة أخرى" onClick={() => setMirrorSource(e)}>
                        <Icon.Link />
                      </button>
                    )}
                    {e.mirrorEntryId && (
                      <button className="btn-ghost" onClick={() => toggleMirrorInfo(e)}>
                        <Icon.Link /> قيد مرآة مرتبط
                      </button>
                    )}
                    <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === e.id ? null : e.id)}>
                      {attachmentsFor === e.id ? "إخفاء المرفقات" : "المرفقات"}
                    </button>
                  </div>
                  {mirrorInfoId === e.id && (
                    <p className="note">
                      {mirrorInfo
                        ? `مرتبط بقيد في شركة ${mirrorInfo.companyName} بتاريخ ${String(mirrorInfo.date).slice(0, 10)} — الحالة: ${mirrorInfo.status === "posted" ? "مرحّل" : "مسودة"}${mirrorInfo.memo ? ` — البيان: ${mirrorInfo.memo}` : ""}`
                        : "جارٍ تحميل بيانات القيد المرتبط..."}
                    </p>
                  )}
                  {attachmentsFor === e.id && <AttachmentsPanel entityType="journal_entry" entityId={e.id} />}
                </div>
              ))}
              {filtered.length === 0 && <p className="empty">لا توجد قيود لهذه الشركة بعد.</p>}
            </div>
          )}

          <ExcelImportPanel
            title="القيود اليومية"
            exampleRows={[{ "التاريخ": "2026-07-20", "البيان": "مثال: إيجار شهر يوليو", "حساب مدين": "مصروف إيجار", "مبلغ مدين": 5000, "حساب دائن": "البنك الأهلي - حساب تشغيلي", "مبلغ دائن": 5000 }]}
            onImportRows={async (rows) => {
              const mapped = rows.map((r) => ({
                date: String(r["التاريخ"]),
                memo: r["البيان"] || "",
                debitAccountName: r["حساب مدين"],
                debitAmount: Number(r["مبلغ مدين"] || 0),
                creditAccountName: r["حساب دائن"],
                creditAmount: Number(r["مبلغ دائن"] || 0),
              }));
              try {
                const result = await importJournalEntries(companyId, mapped);
                reloadEntries();
                return `تم استيراد ${result.imported} قيد بنجاح${result.skipped ? `، وتم تجاهل ${result.skipped} صف غير صالح` : ""}.`;
              } catch (err) {
                return `فشل الاستيراد: ${err.message}`;
              }
            }}
          />
        </>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}
      {viewEntry && (
        <JournalVoucherViewModal
          entry={viewEntry}
          companies={companies}
          autoPrint={autoPrint}
          onClose={() => { setViewEntry(null); setAutoPrint(false); }}
        />
      )}
      {showFromDocument && (
        <CreateFromDocumentModal
          companyId={companyId}
          accounts={accounts}
          onClose={() => setShowFromDocument(false)}
          onCreated={() => { setShowFromDocument(false); reloadEntries(); }}
        />
      )}
      {mirrorSource && (
        <MirrorEntryModal
          entry={mirrorSource}
          companies={companies}
          accounts={accounts}
          onClose={() => setMirrorSource(null)}
          onCreated={(mirror, targetCompany) => {
            setMirrorSource(null);
            setMirrorNotice(`تم إنشاء القيد المقابل كمسودة في شركة ${targetCompany?.shortName || targetCompany?.name}.`);
            reloadEntries();
          }}
        />
      )}
    </div>
  );
}
