import React, { useEffect, useMemo, useState } from "react";
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

const SORT_COLUMNS = { entryNumber: "entryNumber", date: "date", amount: "amount" };

export default function JournalModule({ companies, companyId }) {
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const jf = useDeferredFilters(emptyFilters);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [selectedIds, setSelectedIds] = useState(new Set());

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

  // ترتيب من جهة العميل فقط (لا يغيّر منطق جلب البيانات) — بالضغط على رأس أي عمود من الثلاثة
  // المطلوبة (رقم القيد/التاريخ/المبلغ)، والضغط مرة ثانية على نفس العمود يعكس الاتجاه.
  const toggleSort = (key) => setSort((prev) => (
    prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
  ));
  const sortedEntries = useMemo(() => {
    if (!sort.key) return entries;
    const factor = sort.dir === "asc" ? 1 : -1;
    const valueOf = (e) => (
      sort.key === SORT_COLUMNS.entryNumber ? entryNumberLabel(e)
        : sort.key === SORT_COLUMNS.date ? e.date
          : entryTotal(e)
    );
    return [...entries].sort((a, b) => {
      const va = valueOf(a); const vb = valueOf(b);
      if (va < vb) return -1 * factor;
      if (va > vb) return 1 * factor;
      return 0;
    });
  }, [entries, sort]);

  // تحديد متعدد للصفوف — تجهيز واجهة أساسية لإجراءات جماعية مستقبلية (طباعة/تصدير مجموعة قيود)،
  // الأزرار الفعلية معطَّلة حالياً وموسومة "قريباً" حتى يُنفَّذ منطقها الكامل.
  useEffect(() => { setSelectedIds(new Set()); }, [entries]);
  const toggleSelected = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allSelected = sortedEntries.length > 0 && sortedEntries.every((e) => selectedIds.has(e.id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(sortedEntries.map((e) => e.id)));

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

  const SortHeader = ({ label, sortKey }) => {
    const active = sort.key === sortKey;
    return (
      <th className={"sortable-th" + (active ? " sort-active" : "")} onClick={() => toggleSort(sortKey)}>
        {label} <span className="sort-arrow">{active ? (sort.dir === "asc" ? "▲" : "▼") : "▲▼"}</span>
      </th>
    );
  };

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={["دفتر اليومية", "بيانات حقيقية"]} />
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {notice && <p className="balance-ok">{notice}</p>}

      {!companyId ? (
        <p className="empty">أنشئ شركة أولاً من لوحة القيادة لبدء تسجيل القيود.</p>
      ) : (
        <>
          <div className="journal-page-head">
            <div className="journal-page-head-text">
              <p className="items-eyebrow">دفتر اليومية</p>
              <h2>قائمة القيود المحاسبية</h2>
              <p>تسجيل ومتابعة كل القيود المحاسبية اليومية بحالتيها: محفوظ ومرحّل</p>
            </div>
            <div className="journal-page-head-cta">
              <button className="btn-primary journal-new-entry-btn" onClick={() => setFormModal({ mode: "create" })}>+ قيد يدوي جديد</button>
            </div>
          </div>

          <div className="journal-secondary-actions">
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

          <div className="panel form-panel">
            <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); jf.apply(); }}>
              <label>بحث بالبيان<input type="text" value={jf.draft.search} onChange={(e) => jf.setField("search", e.target.value)} placeholder="بحث بالبيان" /></label>
              <label>رقم القيد<input type="text" value={jf.draft.entryNumber} onChange={(e) => jf.setField("entryNumber", e.target.value)} placeholder="بحث برقم القيد" /></label>
              <label>من تاريخ<input type="date" value={jf.draft.dateFrom} onChange={(e) => jf.setField("dateFrom", e.target.value)} /></label>
              <label>إلى تاريخ<input type="date" value={jf.draft.dateTo} onChange={(e) => jf.setField("dateTo", e.target.value)} /></label>
              <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>إظهار النتائج</button>
              {hasActiveFilters && (
                <button type="button" className="btn-ghost" onClick={clearFilters} style={{ alignSelf: "end" }}>مسح الفلاتر</button>
              )}

              <button type="button" className="journal-filters-toggle" onClick={() => setAdvancedOpen((v) => !v)} style={{ gridColumn: "1 / -1" }}>
                فلاتر متقدمة (حساب معيّن، حالة القيد، المبلغ)
                <span className={"caret" + (advancedOpen ? " open" : "")}>▾</span>
              </button>
              <div className={"journal-advanced-filters" + (advancedOpen ? " open" : "")} style={{ gridColumn: "1 / -1" }}>
                <div className="journal-advanced-filters-inner">
                  <div className="filter-bar" style={{ marginBottom: 0 }}>
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
                    <label>
                      المبلغ
                      <div className="filter-field-pair">
                        <input type="number" value={jf.draft.amountMin} onChange={(e) => jf.setField("amountMin", e.target.value)} placeholder="من" />
                        <input type="number" value={jf.draft.amountMax} onChange={(e) => jf.setField("amountMax", e.target.value)} placeholder="إلى" />
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </form>
          </div>

          {selectedIds.size > 0 && (
            <div className="journal-bulk-toolbar">
              <strong>{selectedIds.size}</strong> قيد محدَّد
              <button className="btn-ghost" disabled title="إجراءات جماعية — قريباً">طباعة المحدَّد (قريباً)</button>
              <button className="btn-ghost" disabled title="إجراءات جماعية — قريباً">تصدير المحدَّد (قريباً)</button>
              <button className="btn-ghost" onClick={() => setSelectedIds(new Set())}>إلغاء التحديد</button>
            </div>
          )}

          <div className="panel">
            <div className="invoices-table-wrap">
              <table className="ledger-table responsive-table journal-table">
                <thead>
                  <tr>
                    <th className="checkbox-col"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="تحديد الكل" /></th>
                    <SortHeader label="رقم القيد" sortKey={SORT_COLUMNS.entryNumber} />
                    <SortHeader label="التاريخ" sortKey={SORT_COLUMNS.date} />
                    <th>البيان</th>
                    <th>عدد الأسطر</th>
                    <SortHeader label="المبلغ" sortKey={SORT_COLUMNS.amount} />
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && [0, 1, 2, 3, 4].map((i) => (
                    <tr key={"sk" + i} className="skeleton-row">
                      <td><span className="skeleton-block" style={{ width: 15 }} /></td>
                      <td><span className="skeleton-block" style={{ width: 55 }} /></td>
                      <td><span className="skeleton-block" style={{ width: 75 }} /></td>
                      <td><span className="skeleton-block" style={{ width: 160 }} /></td>
                      <td><span className="skeleton-block" style={{ width: 25 }} /></td>
                      <td><span className="skeleton-block" style={{ width: 70 }} /></td>
                      <td><span className="skeleton-block" style={{ width: 60 }} /></td>
                      <td><span className="skeleton-block" style={{ width: 110 }} /></td>
                    </tr>
                  ))}
                  {!loading && sortedEntries.map((e) => {
                    const posted = e.status === "posted";
                    const saved = e.status === "saved";
                    const hasLinks = e.mirrorEntryId || e.reversalOfEntryId || e.reversedByEntryId;
                    return (
                      <React.Fragment key={e.id}>
                        <tr>
                          <td data-label=""><input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelected(e.id)} aria-label="تحديد القيد" /></td>
                          <td data-label="رقم القيد">{entryNumberLabel(e)}</td>
                          <td data-label="التاريخ">{fmtDate(e.date)}</td>
                          <td data-label="البيان">{e.memo || "بدون بيان"}</td>
                          <td className="num" data-label="عدد الأسطر">{e.lines.length}</td>
                          <td className="num" data-label="المبلغ">{fmt(entryTotal(e))}</td>
                          <td data-label="الحالة"><span className={"status-badge " + (posted ? "status-posted" : "status-saved")}>{statusLabel(e.status)}</span></td>
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
                          <tr><td colSpan={8}>
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
                          <tr><td colSpan={8}><AttachmentsPanel entityType="journal_entry" entityId={e.id} /></td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {!loading && sortedEntries.length === 0 && (
                    <tr><td colSpan={8}>
                      <div className="journal-empty-state">
                        <span className="journal-empty-icon">📄</span>
                        <strong>لا توجد قيود مطابقة</strong>
                        <span>جرّب تعديل معايير البحث/الفلترة، أو أضف قيداً يدوياً جديداً.</span>
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
