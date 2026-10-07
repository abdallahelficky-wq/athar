import React, { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { listAccounts } from "../api/accounts";
import { listCostCenters } from "../api/costCenters";
import { listDepartments } from "../api/departments";
import { listBranches } from "../api/branches";
import {
  listJournalEntriesPage,
  exportJournalEntries,
  getJournalEntry,
  getJournalEntryPdf,
  deleteJournalEntry,
  postJournalEntry,
  unpostJournalEntry,
} from "../api/journalEntries";
import { fmt } from "../legacy/constants";
import { downloadBlob, Icon } from "../legacy/shared";
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

// branchId: لا حقل له في شريط الفلاتر — يصل فقط من رابط سطر "قيود محفوظة" ليطابق نطاقه، ويُمسَح بإعادة الضبط
const emptyFilters = { search: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", entryNumber: "", accountId: "", status: "", branchId: "" };
function initialFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const out = { ...emptyFilters };
  for (const key of ["status", "accountId", "branchId", "dateFrom", "dateTo"]) {
    const value = params.get(key);
    if (value) out[key] = value;
  }
  return out;
}

// قيم sortBy بالضبط كما يتوقَّعها الخادم (listJournalEntries) — عمود "رقم القيد" يُرتَّب فعلياً عبر
// entrySeq (الرقم التسلسلي الخام) لا entryNumber النصي، لأن الأخير غير موثوق كمفتاح ترتيب (بادئة
// الشركة قابلة للتغيير، والحشو الثابت 5 خانات ينكسر رقمياً بعد تجاوز 99999). القيم القديمة غير
// القابلة للتفسير (entrySeq=NULL) تظهر دائماً آخر الترتيب بصرف النظر عن الاتجاه.
const SORT_COLUMNS = { entryNumber: "entrySeq", date: "date", amount: "amount" };
const PAGE_SIZE = 25;

export default function JournalModule({ companies, companyId }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  // super_admin أو مالك الشركة دائماً، أو أي مستخدم بمنصب مُفوَّض صراحةً بهذه الصلاحية — محسوبة
  // في الخادم (canUnpostJournalEntries ضمن استجابة auth، راجع positions.service.ts) وليس هنا،
  // فالخادم هو مصدر الحقيقة الوحيد؛ هذا فقط لإظهار/إخفاء الزر بلا حاجة لضغطة مرفوضة لمعرفة النتيجة.
  const canUnpost = user?.canUnpostJournalEntries === true;
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branches, setBranches] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const [openingEntryId, setOpeningEntryId] = useState(null);

  // ترقيم صفحات بمؤشر (cursor) — cursorHistory[i] هو المؤشر المُستخدَم لجلب الصفحة i (الصفحة
  // الأولى دائماً cursorHistory[0] = undefined). "رجوع" يُعيد استخدام مؤشر مُخزَّن مسبقاً (لا يحتاج
  // تتبّعاً عكسياً)؛ "تالي" يُضيف nextCursor الذي أرجعه الخادم للصفحة الحالية.
  const [cursorHistory, setCursorHistory] = useState([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  // لا يوجد "مسودة" في دورة حياة القيد الجديدة — "محفوظ" (قابل للتعديل، يؤثر على التقارير فوراً) أو "مرحّل" (مقفل نهائياً)
  const statusLabel = (s) => (s === "posted" ? t("journalEntries.statusPosted") : t("journalEntries.statusSaved"));
  const entryNumberLabel = (e) => e.entryNumber || e.id.slice(-8);
  const fmtDate = (d) => formatDate(d, i18n.language);

  // فلاتر أولية من الرابط (مثلاً ?status=saved&accountId=… من سطر "قيود محفوظة غير محتسبة" في شاشات
  // الأرصدة) — تُقرأ مرة واحدة عند الفتح فقط.
  const jf = useDeferredFilters(initialFiltersFromUrl());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // الترتيب الافتراضي: آخر ما أُدخل أولاً — رقم القيد (entrySeq) تنازلياً ثم وقت الإدخال، لا التاريخ: قيد بتاريخ قديم
  // أُدخل اليوم يبقى أعلى القائمة. الترتيب بالتاريخ أو المبلغ بالنقر على رأس العمود — راجع SORT_LEVEL_DEFS في الخادم.
  const [sort, setSort] = useState({ key: SORT_COLUMNS.entryNumber, dir: "desc" });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const bulkRun = useRef(null);
  useEffect(() => { setBulkProgress(null); return () => { bulkRun.current = null; }; }, [companyId]);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkFailures, setBulkFailures] = useState([]);
  useEffect(() => { setSelectedIds(new Set()); setBulkFailures([]); }, [companyId, jf.applied]);
  const selectedSaved = entries.filter((e) => selectedIds.has(e.id) && e.status === "saved");
  const postSelected = async () => {
    if (bulkRun.current || !selectedSaved.length || !window.confirm(t("bulkPosting.confirm", { count: selectedSaved.length }))) return;
    const run = {}; bulkRun.current = run;
    const targets = [...selectedSaved];
    const failed = [];
    let success = 0;
    setError(""); setNotice(""); setBulkFailures([]);
    setBulkProgress({ done: 0, total: targets.length });
    for (const entry of targets) {
      if (bulkRun.current !== run) return;
      try { await postJournalEntry(entry.id); success++; }
      catch (err) { failed.push({ id: entry.id, number: entryNumberLabel(entry), message: err.message }); }
      if (bulkRun.current !== run) return;
      setBulkProgress({ done: success + failed.length, total: targets.length });
    }
    setSelectedIds(new Set(failed.map((e) => e.id)));
    setBulkFailures(failed);
    setNotice(t("bulkPosting.result", { success, failed: failed.length }));
    bulkRun.current = null;
    setBulkProgress(null);
    reloadCurrentPage();
  };

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

  // فتح قيد محدَّد تلقائياً عبر ?entryId= (رابط "فتح في تبويب جديد" من كشف حساب الأستاذ) — يُفتح
  // بنافذة التعديل مباشرة لو كان القيد "محفوظاً" (قابلاً للتعديل)، أو نافذة العرض لو كان "مرحّلاً"
  // (لا يوجد تعديل لقيد مرحّل في أي مكان بالنظام أصلاً، فنافذة العرض هي المعادل الطبيعي — تتيح
  // الطباعة وتترك أزرار عكس القيد/فك الترحيل ظاهرة بجانبه بالجدول). جلب القيد مباشرة عبر
  // getJournalEntry بدل البحث في قائمة entries المحمَّلة يضمن نجاحه بصرف النظر عن الفلاتر/الصفحات
  // الحالية. يُزال entryId من الرابط بعد الفتح حتى لا يُعاد فتح نفس القيد قسراً عند أي تنقّل لاحق.
  const [searchParams, setSearchParams] = useSearchParams();
  const targetEntryId = searchParams.get("entryId");
  const [highlightedEntryId, setHighlightedEntryId] = useState(null);
  useEffect(() => {
    if (!targetEntryId || !companyId) return;
    let cancelled = false;
    getJournalEntry(targetEntryId).then((entry) => {
      if (cancelled) return;
      if (entry.status === "saved") setFormModal({ mode: "edit", entry });
      else setViewEntry(entry);
      setHighlightedEntryId(entry.id);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("entryId");
        return next;
      }, { replace: true });
    }).catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetEntryId, companyId]);

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

  const reloadEntries = (cursor) => {
    if (!companyId) { setEntries([]); setLoading(false); setHasMore(false); setNextCursor(null); return; }
    setLoading(true);
    const f = jf.applied;
    listJournalEntriesPage({
      companyId,
      search: f.search || undefined,
      dateFrom: f.dateFrom || undefined,
      dateTo: f.dateTo || undefined,
      amountMin: f.amountMin || undefined,
      amountMax: f.amountMax || undefined,
      entryNumber: f.entryNumber || undefined,
      accountId: f.accountId || undefined,
      status: f.status || undefined,
      branchId: f.branchId || undefined,
      sortBy: sort.key,
      sortDir: sort.dir,
      cursor: cursor || undefined,
      take: PAGE_SIZE,
    })
      .then((result) => {
        setEntries(result.items);
        setHasMore(result.hasMore);
        setNextCursor(result.nextCursor);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  /** يُعيد تحميل الصفحة الحالية نفسها (بعد حذف/إضافة/تعديل قيد) بلا إعادة التعيين للصفحة الأولى. */
  const reloadCurrentPage = () => reloadEntries(cursorHistory[pageIndex]);

  // الفلترة لا تُطبَّق إلا عند الضغط على "إظهار النتائج" أو Enter (راجع useDeferredFilters) — لا
  // حاجة لأي تأجيل زمني (debounce) بعد الآن لأن التطبيق نفسه صريح، مش لحظي مع كل كتابة. أي تغيير في
  // الفلاتر/الترتيب/الشركة يُعيد الترقيم للصفحة الأولى دائماً (مؤشرات الصفحات السابقة غير صالحة بعد
  // تغيير معايير البحث).
  useEffect(() => {
    setCursorHistory([undefined]);
    setPageIndex(0);
    reloadEntries(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, jf.applied, sort.key, sort.dir]);

  const clearFilters = () => jf.reset(emptyFilters);
  const hasActiveFilters = Object.values(jf.draft).some((v) => v !== "");

  const entryAmount = (e) => Number(e.totalDebit);

  // الترتيب أصبح من جهة الخادم بالكامل (sortBy/sortDir في كل طلب) — الضغط على رأس أي عمود من
  // الثلاثة المطلوبة (رقم القيد/التاريخ/المبلغ) يُغيّر معيار الطلب نفسه، والضغط مرة ثانية على نفس
  // العمود يعكس الاتجاه؛ useEffect أعلاه يتولى إعادة الجلب من الصفحة الأولى تلقائياً عند أي تغيير.
  const toggleSort = (key) => setSort((prev) => (
    prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }
  ));

  const goNextPage = () => {
    if (!hasMore || nextCursor == null) return;
    setCursorHistory((prev) => [...prev.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
    reloadEntries(nextCursor);
  };
  const goPrevPage = () => {
    if (pageIndex === 0) return;
    const prevIndex = pageIndex - 1;
    setPageIndex(prevIndex);
    reloadEntries(cursorHistory[prevIndex]);
  };

  // تصدير كل القيود المطابقة للفلاتر الحالية (بلا أي حدّ صفحة) — طلب خادم مستقل، لا يعتمد على
  // entries المحمَّلة حالياً (التي تحمل صفحة واحدة فقط بعد الآن). لو تجاوز عدد النتائج الحدّ الأقصى
  // للتصدير يرفضه الخادم برسالة واضحة تطلب تضييق الفلاتر (راجع exportHandler)، تظهر هنا كخطأ عادي.
  const exportEntries = async () => {
    setExporting(true);
    setError("");
    try {
      const f = jf.applied;
      const { blob, filename } = await exportJournalEntries({
        companyId,
        search: f.search || undefined,
        dateFrom: f.dateFrom || undefined,
        dateTo: f.dateTo || undefined,
        amountMin: f.amountMin || undefined,
        amountMax: f.amountMax || undefined,
        entryNumber: f.entryNumber || undefined,
        accountId: f.accountId || undefined,
        status: f.status || undefined,
        branchId: f.branchId || undefined,
        sortBy: sort.key,
        sortDir: sort.dir,
      });
      downloadBlob(blob, filename || t("journalEntries.csvFileName"));
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  // تحديد متعدد للصفوف (طباعة/تصدير مجموعة قيود لا يزالان "قريباً"، أما الترحيل الجماعي فمُفعَّل) —
  // يُقلَّص التحديد لمن تبقّى منه ظاهراً فقط بعد أي إعادة جلب (بدل مسحه بالكامل)، حتى يبقى تحديد
  // محاولات الترحيل الفاشلة ظاهراً بعد postSelected أعلاه.
  useEffect(() => { setSelectedIds((prev) => new Set([...prev].filter((id) => entries.some((e) => e.id === id)))); }, [entries]);

  // تمرير تلقائي + تظليل بصري للقيد المفتوح تلقائياً عبر entryId — إن ظهر ضمن القائمة الحالية
  // (بلا فلاتر تستبعده)، تجربة إضافية فوق فتح النافذة نفسها، وليست شرطاً لعملها.
  useEffect(() => {
    if (!highlightedEntryId) return;
    const row = document.querySelector(`[data-entry-row="${highlightedEntryId}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedEntryId, entries]);
  const toggleSelected = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allSelected = entries.length > 0 && entries.every((e) => selectedIds.has(e.id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(entries.map((e) => e.id)));

  const onSaved = (message) => {
    setFormModal(null);
    reloadCurrentPage();
    setNotice(message);
  };

  const remove = async (entry) => {
    if (!window.confirm(t("journalEntries.confirmDelete"))) return;
    try {
      await deleteJournalEntry(entry.id);
      reloadCurrentPage();
    } catch (err) {
      setError(err.message);
    }
  };

  const doPost = async (entry) => {
    try {
      await postJournalEntry(entry.id);
      reloadCurrentPage();
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

  // القائمة لا تحمل بعد الآن lines/علاقاتها الكاملة (حسابات/مراكز تكلفة/أصول.. انظر listEntrySelect
  // في الخادم) — نافذتا العرض والتعديل/النسخ تحتاجانها فعلياً، فتُجلَب القيد الكامل عبر
  // getJournalEntry أولاً قبل فتح أي منهما، بدل تمرير صف القائمة (الناقص الآن) مباشرة.
  const openView = async (entry) => {
    setOpeningEntryId(entry.id);
    try {
      setViewEntry(await getJournalEntry(entry.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningEntryId(null);
    }
  };
  const openEdit = async (entry) => {
    setOpeningEntryId(entry.id);
    try {
      setFormModal({ mode: "edit", entry: await getJournalEntry(entry.id) });
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningEntryId(null);
    }
  };
  const openDuplicate = async (entry) => {
    setOpeningEntryId(entry.id);
    try {
      setFormModal({ mode: "duplicate", entry: await getJournalEntry(entry.id) });
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningEntryId(null);
    }
  };

  // فك الترحيل إجراء استثنائي محمي بطبقتين (راجع journalEntries.routes.ts/service.ts): صلاحية
  // الوصول للمسار (canUnpost أعلاه)، ثم الرقم السري للشركة (UnpostModal) الذي يتحقق منه الخادم
  // فعلياً، ويُسجَّل تلقائياً في سجل التدقيق من داخل unpostJournalEntry نفسها.
  const doUnpost = async (pin) => {
    const num = entryNumberLabel(unpostTarget);
    await unpostJournalEntry(unpostTarget.id, pin);
    setUnpostTarget(null);
    reloadCurrentPage();
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
            {/* تصدير من الخادم مباشرة (كل القيود المطابقة للفلاتر، بلا حدّ صفحة) بدل تصدير entries
                المحمَّلة محلياً فقط (التي تحمل صفحة واحدة بعد الآن) — راجع exportEntries. */}
            <button className="btn-ghost" onClick={exportEntries} disabled={exporting}>
              {exporting ? t("journalEntries.exporting") : t("journalEntries.exportCsv")}
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

          {bulkFailures.length > 0 && <ul role="alert">{bulkFailures.map((f) => <li key={f.id}>{f.number}: {f.message}</li>)}</ul>}
          {selectedIds.size > 0 && (
            <div className="journal-bulk-toolbar">
              <button className="btn-primary" disabled={loading || !!bulkProgress || !selectedSaved.length} onClick={postSelected}>{bulkProgress ? t("bulkPosting.progress", bulkProgress) : t("bulkPosting.post", { count: selectedSaved.length })}</button>
              <strong>{selectedIds.size}</strong> {t("journalEntries.bulkToolbar.selected")}
              <button className="btn-ghost" disabled title={t("journalEntries.bulkToolbar.comingSoon")}>{t("journalEntries.bulkToolbar.printSelected")}</button>
              <button className="btn-ghost" disabled title={t("journalEntries.bulkToolbar.comingSoon")}>{t("journalEntries.bulkToolbar.exportSelected")}</button>
              <button className="btn-ghost" disabled={!!bulkProgress} onClick={() => setSelectedIds(new Set())}>{t("journalEntries.bulkToolbar.clearSelection")}</button>
            </div>
          )}

          <div className="panel">
            <div className="invoices-table-wrap">
              <table className="ledger-table responsive-table journal-table">
                <thead>
                  <tr>
                    <th className="checkbox-col"><input type="checkbox" disabled={!!bulkProgress} checked={allSelected} onChange={toggleSelectAll} aria-label={t("journalEntries.table.selectAll")} /></th>
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
                  {!loading && entries.map((e) => {
                    const posted = e.status === "posted";
                    const saved = e.status === "saved";
                    const hasLinks = e.mirrorEntryId || e.reversalOfEntryId || e.reversedByEntryId;
                    const opening = openingEntryId === e.id;
                    return (
                      <React.Fragment key={e.id}>
                        <tr data-entry-row={e.id} className={e.id === highlightedEntryId ? "row-highlighted" : undefined}>
                          <td data-label=""><input type="checkbox" disabled={!!bulkProgress} checked={selectedIds.has(e.id)} onChange={() => toggleSelected(e.id)} aria-label={t("journalEntries.table.selectEntry")} /></td>
                          <td data-label={t("journalEntries.table.entryNumber")}>{entryNumberLabel(e)}</td>
                          <td data-label={t("journalEntries.table.date")}>{fmtDate(e.date)}</td>
                          <td data-label={t("journalEntries.table.memo")}>{e.memo || t("journalEntries.table.noMemo")}</td>
                          <td className="num" data-label={t("journalEntries.table.lineCount")}>{e.lineCount}</td>
                          <td className="num" data-label={t("journalEntries.table.amount")}>{fmt(entryAmount(e))}</td>
                          <td data-label={t("journalEntries.table.status")}><span className={"status-badge " + (posted ? "status-posted" : "status-saved")}>{statusLabel(e.status)}</span></td>
                          <td className="row-actions">
                            <button className="icon-btn" disabled={opening} title={t("journalEntries.rowActions.view")} onClick={() => openView(e)}><Icon.Eye /></button>
                            <button
                              className="icon-btn" title={saved ? t("journalEntries.rowActions.edit") : t("journalEntries.rowActions.editDisabled")}
                              disabled={!saved || opening}
                              onClick={() => saved && openEdit(e)}
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
                            {posted && canUnpost && (
                              <button className="icon-btn icon-btn-warn" title={t("journalEntries.rowActions.unpost")} onClick={() => setUnpostTarget(e)}><Icon.Unlock /></button>
                            )}
                            <ActionsMenu
                              items={[
                                { label: t("journalEntries.rowActions.downloadPdf"), icon: Icon.Download, onClick: () => downloadPdf(e) },
                                { label: t("journalEntries.rowActions.duplicate"), icon: Icon.Copy, onClick: () => openDuplicate(e) },
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
                  {!loading && entries.length === 0 && (
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
            <div className="journal-pagination">
              <button className="btn-ghost" onClick={goPrevPage} disabled={pageIndex === 0 || loading}>
                {t("journalEntries.pagination.prev")}
              </button>
              <span className="journal-pagination-page">{t("journalEntries.pagination.page", { page: pageIndex + 1 })}</span>
              <button className="btn-ghost" onClick={goNextPage} disabled={!hasMore || loading}>
                {t("journalEntries.pagination.next")}
              </button>
            </div>
          </div>
        </>
      )}

      {showBulkImport && (
        <BulkImportJournalEntriesModal
          companyId={companyId}
          onClose={() => setShowBulkImport(false)}
          onImported={() => {
            // استيراد جماعي قد يُضيف قيوداً كثيرة بتواريخ قديمة — رجوع للصفحة الأولى (بدل تحديث
            // الصفحة الحالية فقط) ليتأكد المستخدم من نجاح العملية بصرف النظر عن مكان القيود الجديدة
            // ضمن الترتيب الحالي.
            setCursorHistory([undefined]);
            setPageIndex(0);
            reloadEntries(undefined);
          }}
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
          onCreated={() => { setShowFromDocument(false); reloadCurrentPage(); }}
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
            reloadCurrentPage();
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
            reloadCurrentPage();
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
