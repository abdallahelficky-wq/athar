import React, { useEffect, useState } from "react";
import { listAccounts } from "../api/accounts";
import { listCostCenters } from "../api/costCenters";
import {
  listJournalEntries,
  getJournalEntry,
  deleteJournalEntry,
  postJournalEntry,
} from "../api/journalEntries";
import { fmt } from "../legacy/constants";
import { downloadCsv, Icon } from "../legacy/shared";
import AttachmentsPanel from "./shared/AttachmentsPanel";
import CreateFromDocumentModal from "./shared/CreateFromDocumentModal";
import BulkImportJournalEntriesModal from "./shared/BulkImportJournalEntriesModal";
import MirrorEntryModal from "./shared/MirrorEntryModal";
import ReverseEntryModal from "./shared/ReverseEntryModal";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import Breadcrumb from "./shared/Breadcrumb";
import { useDeferredFilters } from "./shared/useDeferredFilters";
import JournalVoucherViewModal from "./JournalVoucherViewModal";
import JournalEntryFormModal from "./JournalEntryFormModal";

const emptyFilters = { search: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", entryNumber: "", accountId: "", status: "" };

// لا يوجد "مسودة" في دورة حياة القيد الجديدة — "محفوظ" (قابل للتعديل، يؤثر على التقارير فوراً) أو "مرحّل" (مقفل نهائياً)
const statusLabel = (s) => (s === "posted" ? "مرحّل" : "محفوظ");
const entryNumberLabel = (e) => e.entryNumber || e.id.slice(-8);
const fmtDate = (d) => String(d).slice(0, 10);

export default function JournalModule({ companies, companyId }) {
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const jf = useDeferredFilters(emptyFilters);

  const [formModal, setFormModal] = useState(null); // { mode: "create" | "edit", entry? }
  const [attachmentsFor, setAttachmentsFor] = useState(null);
  const [showFromDocument, setShowFromDocument] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [viewEntry, setViewEntry] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const [mirrorSource, setMirrorSource] = useState(null);
  const [reverseSource, setReverseSource] = useState(null);
  const [linkInfoId, setLinkInfoId] = useState(null);
  const [linkInfo, setLinkInfo] = useState(null);

  useEffect(() => {
    if (!companyId) { setAccounts([]); return; }
    listAccounts({ companyId }).then(setAccounts).catch((err) => setError(err.message));
  }, [companyId]);

  useEffect(() => {
    listCostCenters().then(setCostCenters).catch((err) => setError(err.message));
  }, [companyId]);

  const reloadEntries = () => {
    if (!companyId) { setEntries([]); setLoading(false); return; }
    setLoading(true);
    const f = jf.applied;
    listJournalEntries({
      companyId,
      search: f.search || undefined,
      dateFrom: f.dateFrom || undefined,
      dateTo: f.dateTo || undefined,
      amountMin: f.amountMin || undefined,
      amountMax: f.amountMax || undefined,
      entryNumber: f.entryNumber || undefined,
      accountId: f.accountId || undefined,
      status: f.status || undefined,
    })
      .then(setEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  // الفلترة لا تُطبَّق إلا عند الضغط على "إظهار النتائج" أو Enter (راجع useDeferredFilters) — لا
  // حاجة لأي تأجيل زمني (debounce) بعد الآن لأن التطبيق نفسه صريح، مش لحظي مع كل كتابة.
  useEffect(() => {
    reloadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, jf.applied]);

  const clearFilters = () => jf.reset(emptyFilters);
  const hasActiveFilters = Object.values(jf.draft).some((v) => v !== "");

  const entryTotal = (e) => e.lines.reduce((s, l) => s + Number(l.debit || 0), 0);

  const onSaved = (message) => {
    setFormModal(null);
    reloadEntries();
    setNotice(message);
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

  const toggleLinkInfo = async (e) => {
    if (linkInfoId === e.id) { setLinkInfoId(null); setLinkInfo(null); return; }
    setLinkInfoId(e.id);
    setLinkInfo(null);
    try {
      const full = await getJournalEntry(e.id);
      setLinkInfo({ mirrorEntry: full.mirrorEntry, reversalOfEntry: full.reversalOfEntry, reversedByEntry: full.reversedByEntry });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["دفتر اليومية", "بيانات حقيقية"]} />
        <h2>قائمة القيود المحاسبية</h2>
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {notice && <p className="balance-ok">{notice}</p>}

      {!companyId ? (
        <p className="empty">أنشئ شركة أولاً من لوحة القيادة لبدء تسجيل القيود.</p>
      ) : (
        <>
          <div className="panel form-panel">
            <div className="form-btn-group" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
              <button className="btn-primary" onClick={() => setFormModal({ mode: "create" })}>+ إضافة قيد يومية</button>
              <button className="btn-ghost" onClick={() => setShowFromDocument(true)}>إنشاء قيد من مستند (ذكاء اصطناعي)</button>
              <button className="btn-ghost" onClick={() => setShowBulkImport(true)}>استيراد قيود بالجملة</button>
              <button
                className="btn-ghost"
                onClick={() => downloadCsv("القيود_اليومية.csv", [
                  ["رقم القيد", "التاريخ", "البيان", "الحالة", "الإجمالي"],
                  ...entries.map((e) => [entryNumberLabel(e), fmtDate(e.date), e.memo, statusLabel(e.status), entryTotal(e)]),
                ])}
              >
                تصدير Excel/CSV
              </button>
            </div>

            <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); jf.apply(); }}>
              <label>البيان<input type="text" value={jf.draft.search} onChange={(e) => jf.setField("search", e.target.value)} placeholder="بحث بالبيان" /></label>
              <label>من تاريخ<input type="date" value={jf.draft.dateFrom} onChange={(e) => jf.setField("dateFrom", e.target.value)} /></label>
              <label>إلى تاريخ<input type="date" value={jf.draft.dateTo} onChange={(e) => jf.setField("dateTo", e.target.value)} /></label>
              <label>
                المبلغ
                <div className="filter-field-pair">
                  <input type="number" value={jf.draft.amountMin} onChange={(e) => jf.setField("amountMin", e.target.value)} placeholder="من" />
                  <input type="number" value={jf.draft.amountMax} onChange={(e) => jf.setField("amountMax", e.target.value)} placeholder="إلى" />
                </div>
              </label>
              <label>رقم القيد<input type="text" value={jf.draft.entryNumber} onChange={(e) => jf.setField("entryNumber", e.target.value)} placeholder="بحث برقم القيد" /></label>
              <label>
                حساب معيّن
                <AccountSearchSelect
                  accounts={accounts}
                  value={jf.draft.accountId}
                  onChange={(accountId) => jf.setField("accountId", accountId)}
                  placeholder="فلترة بحساب من الشجرة"
                  allowClear
                  clearLabel="— كل الحسابات —"
                />
              </label>
              <label>
                حالة القيد
                <select value={jf.draft.status} onChange={(e) => jf.setField("status", e.target.value)}>
                  <option value="">— الكل —</option>
                  <option value="saved">محفوظ</option>
                  <option value="posted">مرحّل</option>
                </select>
              </label>
              <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>إظهار النتائج</button>
              {hasActiveFilters && (
                <button type="button" className="btn-ghost" onClick={clearFilters} style={{ alignSelf: "end" }}>مسح الفلاتر</button>
              )}
            </form>
          </div>

          {loading ? (
            <p className="empty">جارٍ التحميل...</p>
          ) : (
            <div className="panel">
              <div className="invoices-table-wrap">
                <table className="ledger-table responsive-table">
                  <thead>
                    <tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>المبلغ</th><th>الحالة</th><th>الإجراءات</th></tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const posted = e.status === "posted";
                      const saved = e.status === "saved";
                      const hasLinks = e.mirrorEntryId || e.reversalOfEntryId || e.reversedByEntryId;
                      return (
                        <React.Fragment key={e.id}>
                          <tr>
                            <td data-label="رقم القيد">{entryNumberLabel(e)}</td>
                            <td data-label="التاريخ">{fmtDate(e.date)}</td>
                            <td data-label="البيان">{e.memo || "بدون بيان"}</td>
                            <td className="num" data-label="المبلغ">{fmt(entryTotal(e))}</td>
                            <td data-label="الحالة"><span className="status-badge">{statusLabel(e.status)}</span></td>
                            <td className="row-actions">
                              <button className="icon-btn" title="عرض القيد" onClick={() => setViewEntry(e)}><Icon.Eye /></button>
                              <button className="icon-btn" title="طباعة القيد" onClick={() => { setViewEntry(e); setAutoPrint(true); }}><Icon.Printer /></button>
                              <button className="icon-btn" title="نسخ القيد إلى قيد جديد" onClick={() => setFormModal({ mode: "duplicate", entry: e })}><Icon.Copy /></button>
                              <button
                                className="icon-btn" title={saved ? "تعديل" : "لا يمكن التعديل بعد الترحيل — استخدم عكس القيد لتصحيحه"}
                                disabled={!saved}
                                onClick={() => saved && setFormModal({ mode: "edit", entry: e })}
                              ><Icon.Edit /></button>
                              {saved && (
                                <>
                                  <button className="icon-btn icon-btn-danger" title="حذف" onClick={() => remove(e)}><Icon.Trash /></button>
                                  <button className="icon-btn" title="ترحيل" onClick={() => doPost(e)}><Icon.Lock /></button>
                                </>
                              )}
                              {posted && !e.mirrorEntryId && (
                                <button className="icon-btn" title="إنشاء قيد مرآة في شركة أخرى" onClick={() => setMirrorSource(e)}><Icon.Link /></button>
                              )}
                              {posted && !e.reversedByEntryId && (
                                <button className="icon-btn" title="عكس القيد" onClick={() => setReverseSource(e)}><Icon.Unlink /></button>
                              )}
                              {hasLinks && (
                                <button className="icon-btn" title="روابط القيد" onClick={() => toggleLinkInfo(e)}><Icon.BookOpen /></button>
                              )}
                              <button className="btn-ghost" onClick={() => setAttachmentsFor(attachmentsFor === e.id ? null : e.id)}>
                                {attachmentsFor === e.id ? "إخفاء المرفقات" : "المرفقات"}
                              </button>
                            </td>
                          </tr>
                          {linkInfoId === e.id && (
                            <tr><td colSpan={6}>
                              <div className="note">
                                {!linkInfo ? "جارٍ تحميل الروابط..." : (
                                  <>
                                    {linkInfo.mirrorEntry && (
                                      <div>🔗 قيد مرآة مرتبط في شركة {linkInfo.mirrorEntry.companyName} بتاريخ {fmtDate(linkInfo.mirrorEntry.date)} — الحالة: {statusLabel(linkInfo.mirrorEntry.status)}</div>
                                    )}
                                    {linkInfo.reversalOfEntry && (
                                      <div>↩ هذا قيد عاكس للقيد رقم {linkInfo.reversalOfEntry.id.slice(-8)} بتاريخ {fmtDate(linkInfo.reversalOfEntry.date)} — الحالة: {statusLabel(linkInfo.reversalOfEntry.status)}</div>
                                    )}
                                    {linkInfo.reversedByEntry && (
                                      <div>⚠ تم عكس هذا القيد بالقيد رقم {linkInfo.reversedByEntry.id.slice(-8)} بتاريخ {fmtDate(linkInfo.reversedByEntry.date)} — الحالة: {statusLabel(linkInfo.reversedByEntry.status)}</div>
                                    )}
                                    {!linkInfo.mirrorEntry && !linkInfo.reversalOfEntry && !linkInfo.reversedByEntry && "لا توجد روابط حالياً."}
                                  </>
                                )}
                              </div>
                            </td></tr>
                          )}
                          {attachmentsFor === e.id && (
                            <tr><td colSpan={6}><AttachmentsPanel entityType="journal_entry" entityId={e.id} /></td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {entries.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد قيود مطابقة.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </>
      )}

      {showBulkImport && (
        <BulkImportJournalEntriesModal
          companyId={companyId}
          onClose={() => setShowBulkImport(false)}
          onImported={reloadEntries}
        />
      )}

      {formModal && (
        <JournalEntryFormModal
          companyId={companyId}
          accounts={accounts}
          costCenters={costCenters}
          editingEntry={formModal.mode === "edit" ? formModal.entry : null}
          duplicateEntry={formModal.mode === "duplicate" ? formModal.entry : null}
          onClose={() => setFormModal(null)}
          onSaved={onSaved}
        />
      )}
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
            setNotice(`تم إنشاء القيد المقابل كمسودة في شركة ${targetCompany?.shortName || targetCompany?.name}.`);
            reloadEntries();
          }}
        />
      )}
      {reverseSource && (
        <ReverseEntryModal
          entry={reverseSource}
          onClose={() => setReverseSource(null)}
          onCreated={() => {
            setReverseSource(null);
            setNotice("تم إنشاء القيد العكسي كمسودة — راجعه ثم رحّله.");
            reloadEntries();
          }}
        />
      )}
    </div>
  );
}
