import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { listAccounts } from "../api/accounts";
import { listCostCenters } from "../api/costCenters";
import { listDepartments } from "../api/departments";
import { listBranches } from "../api/branches";
import {
  listJournalEntries,
  getJournalEntry,
  getJournalEntryPdf,
  deleteJournalEntry,
  postJournalEntry,
  unpostJournalEntry,
} from "../api/journalEntries";
import { fmt } from "../legacy/constants";
import { downloadCsv, downloadBlob, Icon } from "../legacy/shared";
import AttachmentsPanel from "./shared/AttachmentsPanel";
import CreateFromDocumentModal from "./shared/CreateFromDocumentModal";
import BulkImportJournalEntriesModal from "./shared/BulkImportJournalEntriesModal";
import MirrorEntryModal from "./shared/MirrorEntryModal";
import ReverseEntryModal from "./shared/ReverseEntryModal";
import AccountSearchSelect from "./shared/AccountSearchSelect";
import Breadcrumb from "./shared/Breadcrumb";
import { useDeferredFilters } from "./shared/useDeferredFilters";
import UnpostModal from "./shared/UnpostModal";
import ActionsMenu from "./shared/ActionsMenu";
import JournalVoucherViewModal from "./JournalVoucherViewModal";
import JournalEntryFormModal from "./JournalEntryFormModal";
import { formatDate } from "../i18n/dateFormat";

const emptyFilters = { search: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", entryNumber: "", accountId: "", status: "" };

const SORT_COLUMNS = { entryNumber: "entryNumber", date: "date", amount: "amount" };

export default function JournalModule({ companies, companyId }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // لا يوجد "مسودة" في دورة حياة القيد الجديدة — "محفوظ" (قابل للتعديل، يؤثر على التقارير فوراً) أو "مرحّل" (مقفل نهائياً)
  const statusLabel = (s) => (s === "posted" ? t("journalEntries.statusPosted") : t("journalEntries.statusSaved"));
  const entryNumberLabel = (e) => e.entryNumber || e.id.slice(-8);
  const fmtDate = (d) => formatDate(d, i18n.language);

  const jf = useDeferredFilters(emptyFilters);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [formModal, setFormModal] = useState(null); // { mode: "create" | "edit", entry? }
  const [attachmentsFor, setAttachmentsFor] = useState(null);
  const [showFromDocument, setShowFromDocument] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [viewEntry, setViewEntry] = useState(null);
  const [mirrorSource, setMirrorSource] = useState(null);
  const [reverseSource, setReverseSource] = useState(null);
  const [linkInfoId, setLinkInfoId] = useState(null);
  const [linkInfo, setLinkInfo] = useState(null);
  const [unpostTarget, setUnpostTarget] = useState(null);

  useEffect(() => {
    if (!companyId) { setAccounts([]); return; }
    listAccounts({ companyId }).then(setAccounts).catch((err) => setError(err.message));
  }, [companyId]);

  useEffect(() => {
    listCostCenters().then(setCostCenters).catch((err) => setError(err.message));
    listDepartments().then(setDepartments).catch((err) => setError(err.message));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) { setBranches([]); return; }
    listBranches(companyId).then(setBranches).catch((err) => setError(err.message));
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
    if (!window.confirm(t("journalEntries.confirmDelete"))) return;
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

  // تحميل مباشر لملف PDF لسند القيد (بدل فتح نافذة طباعة المتصفح) — الخادم يولّد الملف فعلياً
  // (نفس آلية renderHtmlToPdf المستخدَمة أصلاً لفواتير المبيعات) ويرجعه كملف ثنائي، فنحوّله هنا
  // مباشرة لتحميل حقيقي (downloadBlob) بلا أي تدخّل إضافي من المستخدم.
  const downloadPdf = async (entry) => {
    try {
      const { blob, filename } = await getJournalEntryPdf(entry.id);
      downloadBlob(blob, filename || `${entryNumberLabel(entry)}.pdf`);
    } catch (err) {
      setError(err.message);
    }
  };

  // فك الترحيل إجراء استثنائي مقيَّد بدور super_admin على الواجهة وعلى الخادم معاً (راجع
  // journalEntries.routes.ts)، ومحمي برقم سري يتحقق منه الخادم فعلياً (UnpostModal)، ويُسجَّل
  // في سجل التدقيق تلقائياً من داخل unpostJournalEntry نفسها — لا شيء إضافي مطلوب هنا لذلك.
  const doUnpost = async (pin) => {
    const num = entryNumberLabel(unpostTarget);
    await unpostJournalEntry(unpostTarget.id, pin);
    setUnpostTarget(null);
    reloadEntries();
    setNotice(t("journalEntries.notify.unposted", { number: num }));
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
        <Breadcrumb parts={[t("journalEntries.breadcrumb"), t("dashboard.breadcrumb.realData")]} />
      </div>

      {error && <p className="balance-bad">{error}</p>}
      {notice && <p className="balance-ok">{notice}</p>}

      {!companyId ? (
        <p className="empty">{t("journalEntries.noCompany")}</p>
      ) : (
        <>
          <div className="journal-page-head">
            <div className="journal-page-head-text">
              <p className="items-eyebrow">{t("journalEntries.eyebrow")}</p>
              <h2>{t("journalEntries.title")}</h2>
              <p>{t("journalEntries.subtitle")}</p>
            </div>
            <div className="journal-page-head-cta">
              <button className="btn-primary journal-new-entry-btn" onClick={() => setFormModal({ mode: "create" })}>{t("journalEntries.newEntry")}</button>
            </div>
          </div>

          <div className="journal-secondary-actions">
            <button className="btn-ghost" onClick={() => setShowFromDocument(true)}>{t("journalEntries.createFromDocument")}</button>
            <button className="btn-ghost" onClick={() => setShowBulkImport(true)}>{t("journalEntries.bulkImport")}</button>
            <button
              className="btn-ghost"
              onClick={() => downloadCsv(t("journalEntries.csvFileName"), [
                [
                  t("journalEntries.csvHeaders.entryNumber"), t("journalEntries.csvHeaders.date"),
                  t("journalEntries.csvHeaders.memo"), t("journalEntries.csvHeaders.status"), t("journalEntries.csvHeaders.total"),
                ],
                ...entries.map((e) => [entryNumberLabel(e), fmtDate(e.date), e.memo, statusLabel(e.status), entryTotal(e)]),
              ])}
            >
              {t("journalEntries.exportCsv")}
            </button>
          </div>

          <div className="panel form-panel">
            <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); jf.apply(); }}>
              <label>{t("journalEntries.filters.searchByMemo")}<input type="text" value={jf.draft.search} onChange={(e) => jf.setField("search", e.target.value)} placeholder={t("journalEntries.filters.searchByMemo")} /></label>
              <label>{t("journalEntries.filters.entryNumber")}<input type="text" value={jf.draft.entryNumber} onChange={(e) => jf.setField("entryNumber", e.target.value)} placeholder={t("journalEntries.filters.entryNumberPlaceholder")} /></label>
              <label>{t("journalEntries.filters.dateFrom")}<input type="date" value={jf.draft.dateFrom} onChange={(e) => jf.setField("dateFrom", e.target.value)} /></label>
              <label>{t("journalEntries.filters.dateTo")}<input type="date" value={jf.draft.dateTo} onChange={(e) => jf.setField("dateTo", e.target.value)} /></label>
              <button type="submit" className="btn-primary" style={{ alignSelf: "end" }}>{t("journalEntries.filters.showResults")}</button>
              {hasActiveFilters && (
                <button type="button" className="btn-ghost" onClick={clearFilters} style={{ alignSelf: "end" }}>{t("journalEntries.filters.clearFilters")}</button>
              )}

              <button type="button" className="journal-filters-toggle" onClick={() => setAdvancedOpen((v) => !v)} style={{ gridColumn: "1 / -1" }}>
                {t("journalEntries.filters.advancedToggle")}
                <span className={"caret" + (advancedOpen ? " open" : "")}>▾</span>
              </button>
              <div className={"journal-advanced-filters" + (advancedOpen ? " open" : "")} style={{ gridColumn: "1 / -1" }}>
                <div className="journal-advanced-filters-inner">
                  <div className="filter-bar" style={{ marginBottom: 0 }}>
                    <label>
                      {t("journalEntries.filters.specificAccount")}
                      <AccountSearchSelect
                        accounts={accounts}
                        value={jf.draft.accountId}
                        onChange={(accountId) => jf.setField("accountId", accountId)}
                        placeholder={t("journalEntries.filters.accountPlaceholder")}
                        allowClear
                        clearLabel={t("journalEntries.filters.allAccounts")}
                      />
                    </label>
                    <label>
                      {t("journalEntries.filters.entryStatus")}
                      <select value={jf.draft.status} onChange={(e) => jf.setField("status", e.target.value)}>
                        <option value="">{t("journalEntries.filters.all")}</option>
                        <option value="saved">{t("journalEntries.filters.saved")}</option>
                        <option value="posted">{t("journalEntries.filters.posted")}</option>
                      </select>
                    </label>
                    <label>
                      {t("journalEntries.filters.amount")}
                      <div className="filter-field-pair">
                        <input type="number" value={jf.draft.amountMin} onChange={(e) => jf.setField("amountMin", e.target.value)} placeholder={t("journalEntries.filters.amountFrom")} />
                        <input type="number" value={jf.draft.amountMax} onChange={(e) => jf.setField("amountMax", e.target.value)} placeholder={t("journalEntries.filters.amountTo")} />
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </form>
          </div>

          {selectedIds.size > 0 && (
            <div className="journal-bulk-toolbar">
              <strong>{selectedIds.size}</strong> {t("journalEntries.bulkToolbar.selected")}
              <button className="btn-ghost" disabled title={t("journalEntries.bulkToolbar.comingSoon")}>{t("journalEntries.bulkToolbar.printSelected")}</button>
              <button className="btn-ghost" disabled title={t("journalEntries.bulkToolbar.comingSoon")}>{t("journalEntries.bulkToolbar.exportSelected")}</button>
              <button className="btn-ghost" onClick={() => setSelectedIds(new Set())}>{t("journalEntries.bulkToolbar.clearSelection")}</button>
            </div>
          )}

          <div className="panel">
            <div className="invoices-table-wrap">
              <table className="ledger-table responsive-table journal-table">
                <thead>
                  <tr>
                    <th className="checkbox-col"><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label={t("journalEntries.table.selectAll")} /></th>
                    <SortHeader label={t("journalEntries.table.entryNumber")} sortKey={SORT_COLUMNS.entryNumber} />
                    <SortHeader label={t("journalEntries.table.date")} sortKey={SORT_COLUMNS.date} />
                    <th>{t("journalEntries.table.memo")}</th>
                    <th>{t("journalEntries.table.lineCount")}</th>
                    <SortHeader label={t("journalEntries.table.amount")} sortKey={SORT_COLUMNS.amount} />
                    <th>{t("journalEntries.table.status")}</th>
                    <th>{t("journalEntries.table.actions")}</th>
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
                          <td data-label=""><input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelected(e.id)} aria-label={t("journalEntries.table.selectEntry")} /></td>
                          <td data-label={t("journalEntries.table.entryNumber")}>{entryNumberLabel(e)}</td>
                          <td data-label={t("journalEntries.table.date")}>{fmtDate(e.date)}</td>
                          <td data-label={t("journalEntries.table.memo")}>{e.memo || t("journalEntries.table.noMemo")}</td>
                          <td className="num" data-label={t("journalEntries.table.lineCount")}>{e.lines.length}</td>
                          <td className="num" data-label={t("journalEntries.table.amount")}>{fmt(entryTotal(e))}</td>
                          <td data-label={t("journalEntries.table.status")}><span className={"status-badge " + (posted ? "status-posted" : "status-saved")}>{statusLabel(e.status)}</span></td>
                          <td className="row-actions">
                            <button className="icon-btn" title={t("journalEntries.rowActions.view")} onClick={() => setViewEntry(e)}><Icon.Eye /></button>
                            <button
                              className="icon-btn" title={saved ? t("journalEntries.rowActions.edit") : t("journalEntries.rowActions.editDisabled")}
                              disabled={!saved}
                              onClick={() => saved && setFormModal({ mode: "edit", entry: e })}
                            ><Icon.Edit /></button>
                            <button className="icon-btn" title={t("journalEntries.rowActions.downloadPdf")} onClick={() => downloadPdf(e)}><Icon.Download /></button>
                            {saved && (
                              <>
                                <button className="icon-btn icon-btn-danger" title={t("journalEntries.rowActions.delete")} onClick={() => remove(e)}><Icon.Trash /></button>
                                <button className="icon-btn" title={t("journalEntries.rowActions.post")} onClick={() => doPost(e)}><Icon.Lock /></button>
                              </>
                            )}
                            {posted && !e.reversedByEntryId && (
                              <button className="icon-btn" title={t("journalEntries.rowActions.reverse")} onClick={() => setReverseSource(e)}><Icon.Unlink /></button>
                            )}
                            {posted && isSuperAdmin && (
                              <button className="icon-btn icon-btn-warn" title={t("journalEntries.rowActions.unpost")} onClick={() => setUnpostTarget(e)}><Icon.Unlock /></button>
                            )}
                            <ActionsMenu
                              items={[
                                { label: t("journalEntries.rowActions.downloadPdf"), icon: Icon.Download, onClick: () => downloadPdf(e) },
                                { label: t("journalEntries.rowActions.duplicate"), icon: Icon.Copy, onClick: () => setFormModal({ mode: "duplicate", entry: e }) },
                                { label: t("journalEntries.rowActions.mirror"), icon: Icon.Link, onClick: () => setMirrorSource(e), hidden: !posted || Boolean(e.mirrorEntryId) },
                                { label: t("journalEntries.rowActions.links"), icon: Icon.BookOpen, onClick: () => toggleLinkInfo(e), hidden: !hasLinks },
                                {
                                  label: attachmentsFor === e.id ? t("journalEntries.rowActions.attachmentsHide") : t("journalEntries.rowActions.attachmentsShow"),
                                  icon: Icon.Paperclip,
                                  onClick: () => setAttachmentsFor(attachmentsFor === e.id ? null : e.id),
                                },
                              ]}
                            />
                          </td>
                        </tr>
                        {linkInfoId === e.id && (
                          <tr><td colSpan={8}>
                            <div className="note">
                              {!linkInfo ? t("journalEntries.linkInfo.loading") : (
                                <>
                                  {linkInfo.mirrorEntry && (
                                    <div>{t("journalEntries.linkInfo.mirror", { company: linkInfo.mirrorEntry.companyName, date: fmtDate(linkInfo.mirrorEntry.date), status: statusLabel(linkInfo.mirrorEntry.status) })}</div>
                                  )}
                                  {linkInfo.reversalOfEntry && (
                                    <div>{t("journalEntries.linkInfo.reversalOf", { id: linkInfo.reversalOfEntry.id.slice(-8), date: fmtDate(linkInfo.reversalOfEntry.date), status: statusLabel(linkInfo.reversalOfEntry.status) })}</div>
                                  )}
                                  {linkInfo.reversedByEntry && (
                                    <div>{t("journalEntries.linkInfo.reversedBy", { id: linkInfo.reversedByEntry.id.slice(-8), date: fmtDate(linkInfo.reversedByEntry.date), status: statusLabel(linkInfo.reversedByEntry.status) })}</div>
                                  )}
                                  {!linkInfo.mirrorEntry && !linkInfo.reversalOfEntry && !linkInfo.reversedByEntry && t("journalEntries.linkInfo.none")}
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
                        <strong>{t("journalEntries.emptyState.title")}</strong>
                        <span>{t("journalEntries.emptyState.subtitle")}</span>
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
          companies={companies}
          accounts={accounts}
          costCenters={costCenters}
          departments={departments}
          branches={branches}
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
          onClose={() => setViewEntry(null)}
        />
      )}
      {showFromDocument && (
        <CreateFromDocumentModal
          companyId={companyId}
          companies={companies}
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
            setNotice(t("journalEntries.notify.mirrorCreated", { company: targetCompany?.shortName || targetCompany?.name }));
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
            setNotice(t("journalEntries.notify.reverseCreated"));
            reloadEntries();
          }}
        />
      )}
      {unpostTarget && (
        <UnpostModal
          title={t("journalEntries.unpostTitle", { number: entryNumberLabel(unpostTarget) })}
          warningText={t("journalEntries.unpostWarning")}
          onCancel={() => setUnpostTarget(null)}
          onConfirm={doUnpost}
        />
      )}
    </div>
  );
}
