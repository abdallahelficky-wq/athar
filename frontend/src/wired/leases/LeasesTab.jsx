import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import * as api from "../../api/leaseContracts";
import { listAccounts } from "../../api/accounts";
import { listCostCenters } from "../../api/costCenters";
import { formatDate } from "../../i18n/dateFormat";
import { fmt2 } from "../../legacy/constants";
import { routes } from "../../routes";
import LeaseDialog from "./LeaseDialog";
import LeaseReportView from "./LeaseReportView";
import { LeaseBrandsDialog, LeaseNoticeDialog } from "./LeaseExtras";
import AccountSearchSelect from "../shared/AccountSearchSelect";
import "../../styles/lease-dialogs.css";
import "../../styles/lease-screen.css";
import AttachmentsPanel from "../shared/AttachmentsPanel";

/**
 * الإيجارات: تقويم دفعات عقود الإيجار (عقد × شهر)، تأكيد السداد بقيد آلي (إيجار مدفوع مقدماً + ضريبة مدخلات / البنك)،
 * وإطفاء المصروف شهرياً. ثلاثة عروض: التقويم، العقود، الإطفاء الشهري. المنطق والقيود في src/modules/leaseContracts.
 */
const localDay = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const pad = (n) => String(n).padStart(2, "0");
const monthOf = (day) => day.slice(0, 7);
const addMonth = (month, n) => { const [y, m] = month.split("-").map(Number); const i = y * 12 + m - 1 + n; return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`; };
const monthEnd = (month) => { const [y, m] = month.split("-").map(Number); return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const monthsBetween = (from, to) => { const out = []; for (let m = from; m <= to && out.length < 36; m = addMonth(m, 1)) out.push(m); return out; };

const toneOf = (p) => (p.status === "due" && p.overdue ? "overdue" : p.status);
const STATUS_COLOR = { active: "#1F5C3A", suspended: "#7A5212", stopped: "#8A2F1B", ended: "#666" };
const CONTRACT_STATUSES = ["active", "suspended", "stopped", "ended"];
const SUB = { fontSize: 12, lineHeight: 1.5, opacity: 0.7, fontWeight: 400, fontFamily: "inherit" };
const emptyContract = {
  title: "", counterparty: "", costCenterId: "", vatMode: "none", paymentAmount: "", paymentEveryMonths: "", firstDueDate: "", startDate: "", endDate: "", expenseAccountId: "", prepaidAccountId: "", notes: "", isActive: true,
  contractNumber: "", signedOn: "", contractValue: "", depositAmount: "", noticeDays: "", autoRenew: false, customTerms: "", lessor: {}, property: {}, brandId: "",
};
const LESSOR_FIELDS = ["idNumber", "crNumber", "unifiedNumber", "vatNumber", "representative", "representativeId", "mobile", "email", "address", "iban"];
const PROPERTY_FIELDS = ["address", "city", "unitType", "area", "deedNumber"];
const ALERT_TONE = { expired: "overdue", notice_passed: "overdue", notice_soon: "due" };

export default function LeasesTab({ companyId, companyName = "" }) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState("contracts"); // العقود هي الشاشة الافتتاحية، ثم التقويم
  const [range, setRange] = useState(() => { const m = monthOf(localDay()); return { from: m, to: addMonth(m, 12) }; });
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState(""); // "" | contract | accounts | payment | newPayment | generate | reverse | removeRun
  const [form, setForm] = useState({});
  const [amortMonth, setAmortMonth] = useState(() => monthOf(localDay()));
  const [preview, setPreview] = useState(null);
  const [runs, setRuns] = useState([]);
  const [alerts, setAlerts] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  // الشهر المفتوح في نافذة «مستحقات الشهر»؛ يبقى محفوظاً أثناء فتح نافذة دفعة أو عقد منها فتعود إليه بعد إغلاقها
  const [openMonth, setOpenMonth] = useState(null);
  const [search, setSearch] = useState("");
  const [brands, setBrands] = useState([]);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [noticeFor, setNoticeFor] = useState(null);
  const fileRef = useRef(null);

  // تواريخ الاستحقاق والسداد أيام تقويمية مخزَّنة منتصف ليل UTC — تُعرَض بتوقيت UTC فلا تنزاح يوماً
  const fmtDay = (v) => formatDate(v, i18n.language, { timeZone: "UTC" });
  const fmtMonth = (m) => formatDate(`${m}-01`, i18n.language, { timeZone: "UTC", month: "short", year: "numeric" });
  const postingAccounts = useMemo(() => accounts.filter((a) => a.isPosting && a.isActive && !a.isArchived), [accounts]);
  const bankAccounts = useMemo(() => postingAccounts.filter((a) => a.isBankOrCash), [postingAccounts]);
  const companyCostCenters = useMemo(() => costCenters.filter((c) => !c.companyId || c.companyId === companyId), [costCenters, companyId]);
  const months = useMemo(() => monthsBetween(range.from, range.to), [range.from, range.to]);

  useEffect(() => {
    if (!companyId) return;
    Promise.all([listAccounts({ companyId }), listCostCenters()])
      .then(([a, c]) => { setAccounts(a); setCostCenters(c); })
      .catch((e) => setError(e.message));
  }, [companyId]);

  const load = () => Promise.all([api.leaseCalendar(companyId, `${range.from}-01`, monthEnd(range.to)), api.leaseAlerts(companyId)])
    .then(([c, a]) => { setData(c); setAlerts(a); })
    .catch((e) => setError(e.message));
  const loadAmortization = () => Promise.all([api.previewLeaseAmortization(companyId, amortMonth), api.listLeaseAmortizationRuns(companyId)])
    .then(([p, r]) => { setPreview(p); setRuns(r); })
    .catch((e) => setError(e.message));
  const loadBrands = () => api.listLeaseBrands(companyId).then(setBrands).catch((e) => setError(e.message));
  useEffect(() => { if (companyId) loadBrands(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (companyId && range.from <= range.to) load(); }, [companyId, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (companyId && view === "amortization" && amortMonth) loadAmortization(); }, [companyId, view, amortMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setDialog("");
  const open = (name, initial = {}) => { setError(""); setMessage(""); setForm(initial); setDialog(name); };
  const run = async (fn, okKey, okParams) => {
    setError("");
    try {
      const result = await fn();
      close();
      setMessage(t(okKey, { ...okParams, ...(result && typeof result === "object" ? result : {}) }));
      await load();
      if (view === "amortization") await loadAmortization();
    } catch (e) { setError(e.message); }
  };

  // --- العقود ---
  const openContract = (c) => open("contract", c
    ? {
      ...emptyContract, ...c, counterparty: c.counterparty || "", costCenterId: c.costCenterId || "", paymentAmount: c.paymentAmount ?? "", paymentEveryMonths: c.paymentEveryMonths ?? "", firstDueDate: c.firstDueDate || "", expenseAccountId: c.expenseAccountId || "", prepaidAccountId: c.prepaidAccountId || "", notes: c.notes || "",
      contractNumber: c.contractNumber || "", signedOn: c.signedOn || "", contractValue: c.contractValue ?? "", depositAmount: c.depositAmount ?? "", noticeDays: c.noticeDays ?? "", autoRenew: !!c.autoRenew, customTerms: c.customTerms || "",
      lessor: { ...(c.lessorDetails || {}) }, property: { ...(c.propertyDetails || {}) }, brandId: c.brandId || "",
    }
    : emptyContract);
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const details = (obj, fields) => { const out = Object.fromEntries(fields.filter((k) => (obj?.[k] || "").trim()).map((k) => [k, obj[k].trim()])); return out; };
  const saveContract = () => {
    if (!form.title?.trim() || !form.startDate || !form.endDate) { setError(t("leases.errRequired")); return undefined; }
    const payload = {
      title: form.title.trim(), counterparty: form.counterparty.trim() || null, costCenterId: form.costCenterId || null, vatMode: form.vatMode,
      paymentAmount: form.paymentAmount === "" ? null : Number(form.paymentAmount), paymentEveryMonths: form.paymentEveryMonths === "" ? null : Number(form.paymentEveryMonths),
      firstDueDate: form.firstDueDate || null, startDate: form.startDate, endDate: form.endDate,
      expenseAccountId: form.expenseAccountId || null, prepaidAccountId: form.prepaidAccountId || null, notes: form.notes.trim() || null,
      contractNumber: form.contractNumber.trim() || null, signedOn: form.signedOn || null, contractValue: num(form.contractValue), depositAmount: num(form.depositAmount),
      noticeDays: num(form.noticeDays), autoRenew: !!form.autoRenew, customTerms: form.customTerms.trim() || null, brandId: form.brandId || null,
      lessorDetails: (() => { const d = details(form.lessor, LESSOR_FIELDS); if (form.lessor?.type) d.type = form.lessor.type; return Object.keys(d).length ? d : null; })(),
      propertyDetails: (() => { const d = details(form.property, PROPERTY_FIELDS); return Object.keys(d).length ? d : null; })(),
    };
    return run(() => (form.id ? api.updateLeaseContract(form.id, payload) : api.createLeaseContract({ companyId, ...payload })), "leases.savedOk");
  };
  const removeContract = (c) => {
    if (!window.confirm(t("leases.confirmDeleteContract", { title: c.title }))) return;
    run(() => api.deleteLeaseContract(c.id), "leases.deletedOk");
  };
  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(""); setMessage("");
    try {
      const parsed = JSON.parse(await file.text());
      const contracts = Array.isArray(parsed) ? parsed : parsed.contracts;
      if (!Array.isArray(contracts)) throw new Error(t("leases.importBadFile"));
      const result = await api.importLeaseContracts(companyId, contracts);
      setMessage(t("leases.importedOk", result));
      await load();
    } catch (err) { setError(err instanceof SyntaxError ? t("leases.importBadFile") : err.message); }
  };

  // --- بريد التنبيهات اليومي ---
  const openReminder = async () => {
    setError(""); setMessage("");
    try {
      const r = await api.getLeaseReminder(companyId);
      setForm({ enabled: r.enabled, hourKsa: r.hourKsa, minuteKsa: r.minuteKsa ?? 0, emails: r.recipientEmails.join("\n"), effective: r.effectiveRecipients, lastSentAt: r.lastSentAt });
      setDialog("reminder");
    } catch (e) { setError(e.message); }
  };
  const reminderPayload = () => ({ companyId, enabled: !!form.enabled, hourKsa: Number(form.hourKsa), minuteKsa: Number(form.minuteKsa ?? 0), recipientEmails: (form.emails || "").split(/[\s,،;]+/).map((x) => x.trim()).filter(Boolean) });
  const saveReminder = () => run(() => api.saveLeaseReminder(reminderPayload()).then(() => undefined), "leases.reminder.savedOk");
  const sendReminderNow = async () => {
    setError("");
    try {
      await api.saveLeaseReminder(reminderPayload());
      const r = await api.sendLeaseReminderNow(companyId);
      close();
      setMessage(r.sent ? t("leases.reminder.sentOk", { count: r.recipients }) : t(`leases.reminder.notSent.${r.reason}`));
    } catch (e) { setError(e.message); }
  };

  // --- الدفعات ---
  const contractOf = (id) => data?.contracts.find((c) => c.id === id);
  const openPayment = (p) => open("payment", {
    ...p, mode: "view", paidOnInput: localDay(), bankAccountId: bankAccounts[0]?.id || "", amountInput: p.amount, referenceInput: "", noteInput: p.note || "",
    external: false, amortizeFromMonth: "", editDueDate: p.dueDate, editFrom: p.periodFrom, editTo: p.periodTo,
  });
  const confirmPayment = () => run(() => api.confirmLeasePayment(form.id, {
    paidOn: form.paidOnInput, amount: Number(form.amountInput), reference: form.referenceInput || null, note: form.noteInput || null,
    ...(form.external ? { postedExternally: true, amortizeFromMonth: form.amortizeFromMonth || null } : { bankAccountId: form.bankAccountId }),
  }), "leases.confirmedOk");
  const savePaymentEdit = () => run(() => api.updateLeasePayment(form.id, { dueDate: form.editDueDate, periodFrom: form.editFrom, periodTo: form.editTo, amount: Number(form.amountInput), note: form.noteInput || null }), "leases.savedOk");
  const setWaived = (waived) => run(() => api.updateLeasePayment(form.id, { status: waived ? "waived" : "due", note: form.noteInput || null }), "leases.savedOk");
  const removePayment = () => {
    if (!window.confirm(t("leases.confirmDeletePayment"))) return;
    run(() => api.deleteLeasePayment(form.id), "leases.deletedOk");
  };
  const saveNewPayment = () => run(() => api.createLeasePayment({
    leaseContractId: form.leaseContractId, dueDate: form.dueDate, periodFrom: form.periodFrom, periodTo: form.periodTo, amount: Number(form.amount), note: form.note || null,
  }), "leases.savedOk");
  const saveReverse = () => {
    if (!form.reason?.trim()) { setError(t("leases.reasonRequired")); return undefined; }
    return run(() => api.reverseLeasePayment(form.id, form.reason.trim()), "leases.reversedOk");
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;
  const contracts = data?.contracts || [];
  const payments = data?.payments || [];
  const totals = data?.totals || {};
  // معاينة القيد قبل التأكيد فقط (15%): الخادم يفصل الضريبة بنسبة الشركة عند الترحيل
  const previewGross = Number(form.amountInput || 0);
  const previewVat = contractOf(form.leaseContractId)?.vatMode === "inclusive" ? Math.round((previewGross * 15 / 115) * 100) / 100 : 0;
  const kpis = [
    { key: "due", value: totals.due, tone: "revenue" }, { key: "paid", value: totals.paid, tone: "profit" },
    { key: "outstanding", value: totals.outstanding, tone: "receivable" }, { key: "overdue", value: totals.overdue, tone: "payable" },
    { key: "vat", value: totals.vat, tone: "cash" },
  ];
  const formContract = form.leaseContractId ? contractOf(form.leaseContractId) : null;
  const statusOf = (c) => c.status || "active";
  const statusCounts = contracts.reduce((acc, c) => { acc[statusOf(c)] = (acc[statusOf(c)] || 0) + 1; return acc; }, {});
  const attachedCount = contracts.filter((c) => c.attachmentCount > 0).length;
  const STATUS_ORDER = { active: 0, suspended: 1, stopped: 2, ended: 3 };
  const needle = search.trim().toLowerCase();
  const shownContracts = contracts
    .filter((c) => statusFilter === "all" || statusOf(c) === statusFilter)
    .filter((c) => !needle || [c.title, c.counterparty, c.contractNumber, c.costCenterName, c.brandName, c.propertyDetails?.city].some((v) => (v || "").toLowerCase().includes(needle)))
    .sort((x, y) => STATUS_ORDER[statusOf(x)] - STATUS_ORDER[statusOf(y)] || x.title.localeCompare(y.title, "ar"));
  const openStatus = (c) => open("contractStatus", { id: c.id, title: c.title, current: statusOf(c), status: statusOf(c), reason: c.statusReason || "", effectiveDate: localDay(), history: c.statusHistory || [] });
  const openView = (c) => {
    open("view", { id: c.id, title: c.title, loading: true, contract: c, payments: [], totals: null });
    api.getLeaseContractDetails(c.id)
      .then((d) => setForm((f) => (f.id === c.id ? { ...f, ...d, loading: false } : f)))
      .catch((e) => { setError(e.message); setForm((f) => (f.id === c.id ? { ...f, loading: false } : f)); });
  };
  const fmtMonthLong = (m) => formatDate(`${m}-01`, i18n.language, { timeZone: "UTC", month: "long", year: "numeric" });
  const thisMonth = localDay().slice(0, 7);
  // دفعات الشهر المستحقة فعلاً: تُستبعد «سماح» ودفعات العقود المعلّقة/الموقوفة/المنتهية (onHold)
  const dueOfMonth = (m) => payments.filter((p) => p.month === m && p.status !== "waived" && !p.onHold).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (contractOf(a.leaseContractId)?.title || "").localeCompare(contractOf(b.leaseContractId)?.title || "", "ar"));
  const monthCard = (m) => {
    const rows = dueOfMonth(m);
    const sum = (list) => list.reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const paid = rows.filter((p) => p.status === "paid");
    const overdue = rows.filter((p) => p.overdue);
    return { rows, total: sum(rows), paid: sum(paid), paidCount: paid.length, outstanding: sum(rows) - sum(paid), overdueCount: overdue.length, held: payments.filter((p) => p.month === m && p.onHold).length };
  };
  const pickMonth = (m) => setOpenMonth(m);
  const KPI_TONE = { due: "blue", paid: "green", outstanding: "amber", overdue: "red", vat: "teal" };

  return (
    <div className="lease-screen">
      <div className="ls-hero">
        <div className="ls-hero-top">
          <div className="ls-hero-main">
            <div className="ls-hero-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" /></svg>
            </div>
            <div>
              <h3>{t("leases.title")}</h3>
              <p>{t("leases.note")}</p>
            </div>
          </div>
          <div className="ls-hero-actions">
            <button className="ls-btn ls-btn-glass" onClick={() => fileRef.current?.click()}>{t("leases.importBtn")}</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={importFile} />
            <button className="ls-btn ls-btn-glass" onClick={openReminder}>{t("leases.reminder.btn")}</button>
            <button className="ls-btn ls-btn-glass" onClick={() => { setError(""); setBrandsOpen(true); }}>{t("leases.brands.btn")}</button>
            <button className="ls-btn ls-btn-glass" onClick={() => open("accounts", { expenseAccountId: "", prepaidAccountId: "", onlyMissing: true })} disabled={!contracts.length}>{t("leases.accountsBtn")}</button>
            <button className="ls-btn ls-btn-accent" onClick={() => openContract(null)}>+ {t("leases.newContract")}</button>
          </div>
        </div>
        <div className="ls-chips">
          {["all", ...CONTRACT_STATUSES].map((st) => (
            <button key={st} type="button" className={`ls-chip st-${st}${statusFilter === st ? " is-on" : ""}`} onClick={() => { setStatusFilter(st); setView("contracts"); }}>
              <b>{st === "all" ? contracts.length : statusCounts[st] || 0}</b>{st === "all" ? t("leases.screen.all") : t(`leases.contractStatus.${st}`)}
            </button>
          ))}
          <span className="ls-chip ls-chip-info"><b>{attachedCount}/{contracts.length}</b>{t("leases.screen.attached")}</span>
        </div>
      </div>

      {error && !dialog && <p className="ls-msg ls-msg-bad">{error}</p>}
      {message && <p className="ls-msg ls-msg-ok">{message}</p>}

      {(view === "contracts" || view === "calendar") && (
        <div className="ls-kpis">
          {kpis.map((k) => (
            <div key={k.key} className={`ls-kpi tone-${KPI_TONE[k.key]}`}>
              <div className="ls-kpi-label">{t(`leases.kpi.${k.key}`)}{k.key === "overdue" && totals.overdueCount ? ` (${totals.overdueCount})` : ""}</div>
              <div className="ls-kpi-value">{fmt2(k.value || 0)}</div>
            </div>
          ))}
        </div>
      )}

      {alerts && (alerts.overdue.length + alerts.dueSoon.length + alerts.renewals.length > 0) && (
        <div className="ls-alerts">
          {[
            { key: "overdue", rows: alerts.overdue, tone: "red", total: alerts.totals.overdue },
            { key: "dueSoon", rows: alerts.dueSoon, tone: "amber", total: alerts.totals.dueSoon },
          ].filter((g) => g.rows.length > 0).map((g) => (
            <div key={g.key} role="status" className={`ls-alert tone-${g.tone}`}>
              <div className="ls-alert-head"><span className="ls-alert-count">{g.rows.length}</span><strong>{t(`leases.alerts.${g.key}`, { count: g.rows.length, days: alerts.dueWithinDays })}</strong><span className="ls-alert-total">{fmt2(g.total)}</span></div>
              {g.rows.slice(0, 6).map((p) => (
                <div key={p.id} className="ls-alert-row">
                  <span className="ls-alert-title">{p.title}</span>
                  <span className="ls-alert-amount">{fmt2(p.amount)}</span>
                  <span className="ls-pill">{fmtDay(p.dueDate)} · {t(p.days < 0 ? "leases.alerts.daysLate" : "leases.alerts.daysLeft", { count: Math.abs(p.days) })}</span>
                </div>
              ))}
              {g.rows.length > 6 && <div className="ls-alert-more">{t("leases.alerts.more", { count: g.rows.length - 6 })}</div>}
            </div>
          ))}
          {alerts.renewals.length > 0 && (
            <div role="status" className="ls-alert tone-blue">
              <div className="ls-alert-head"><span className="ls-alert-count">{alerts.renewals.length}</span><strong>{t("leases.alerts.renewals", { count: alerts.renewals.length, days: alerts.renewalWithinDays })}</strong></div>
              {alerts.renewals.slice(0, 8).map((r) => (
                <div key={r.id} className="ls-alert-row">
                  <span className="ls-alert-title">{r.title}</span>
                  <span className={`ls-pill${ALERT_TONE[r.kind] === "overdue" ? " is-bad" : ""}`}>{t(`leases.alerts.kinds.${r.kind}`, { date: fmtDay(r.kind === "expired" ? r.endDate : r.noticeDeadline), count: Math.abs(r.kind === "expired" ? r.daysToEnd : r.daysToDeadline) })}</span>
                  {contractOf(r.id) && <button type="button" className="ls-link" onClick={() => setNoticeFor(contractOf(r.id))}>{t("leases.notice.btn")}</button>}
                </div>
              ))}
              {alerts.renewals.length > 8 && <div className="ls-alert-more">{t("leases.alerts.more", { count: alerts.renewals.length - 8 })}</div>}
            </div>
          )}
        </div>
      )}

      <div className="ls-toolbar">
        <div className="ls-tabs" role="tablist">
          {["contracts", "calendar", "report", "amortization"].map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={`ls-tab${view === v ? " is-on" : ""}`} onClick={() => { setError(""); setMessage(""); setView(v); }}>{t(`leases.views.${v}`)}</button>
          ))}
        </div>
        {(view === "contracts" || view === "calendar") && (
          <div className="ls-range">
            <label>{t("leases.fromMonth")}<input type="month" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></label>
            <label>{t("leases.toMonth")}<input type="month" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></label>
          </div>
        )}
      </div>

      {view === "calendar" && (
        <div className="panel ls-panel">
          <div className="ls-months">
            {months.map((m) => {
              const mc = monthCard(m);
              const pct = mc.total ? Math.round((mc.paid / mc.total) * 100) : 0;
              const tone = !mc.rows.length ? "empty" : mc.overdueCount ? "late" : mc.outstanding <= 0 ? "done" : "open";
              return (
                <button key={m} type="button" disabled={!mc.rows.length} aria-haspopup="dialog"
                  className={`ls-month tone-${tone}${openMonth === m ? " is-on" : ""}${m === thisMonth ? " is-now" : ""}`} onClick={() => pickMonth(m)}>
                  <span className="ls-month-head">
                    <span className="ls-month-name">{fmtMonthLong(m)}</span>
                    {m === thisMonth && <span className="ls-month-now">{t("leases.cal.thisMonth")}</span>}
                  </span>
                  {mc.rows.length ? (
                    <>
                      <span className="ls-month-total">{fmt2(mc.total)}</span>
                      <span className="ls-month-sub">{t("leases.cal.paymentsCount", { count: mc.rows.length })}{mc.overdueCount ? ` · ${t("leases.cal.overdueCount", { count: mc.overdueCount })}` : ""}</span>
                      <span className="ls-month-bar"><span style={{ width: `${pct}%` }} /></span>
                      <span className="ls-month-split">
                        <span>{t("leases.kpi.paid")}: <b>{fmt2(mc.paid)}</b></span>
                        <span>{t("leases.kpi.outstanding")}: <b>{fmt2(mc.outstanding)}</b></span>
                      </span>
                    </>
                  ) : (
                    <span className="ls-month-none">{t("leases.cal.noDue")}</span>
                  )}
                  {mc.held > 0 && <span className="ls-month-held">{t("leases.cal.heldCount", { count: mc.held })}</span>}
                </button>
              );
            })}
          </div>
          {data && contracts.length === 0 && <p className="empty">{t("leases.noContracts")}</p>}

        </div>
      )}

      {view === "contracts" && (
        <div className="panel ls-panel">
          <div className="ls-filter">
            <input type="search" value={search} placeholder={t("leases.screen.searchPlaceholder")} onChange={(e) => setSearch(e.target.value)} />
            <span className="ls-filter-count">{t("leases.screen.shown", { count: shownContracts.length, total: contracts.length })}</span>
          </div>
          <div className="ls-cards">
            {shownContracts.map((c) => (
              <div key={c.id} className={`ls-card st-${statusOf(c)}`}>
                <div className="ls-card-head">
                  <div className="ls-card-title">
                    <strong>{c.title}</strong>
                    <span>{c.counterparty || "—"}</span>
                  </div>
                  <span className={`ls-badge st-${statusOf(c)}`}>{t(`leases.contractStatus.${statusOf(c)}`)}</span>
                </div>
                {statusOf(c) !== "active" && c.statusReason && <div className="ls-card-reason">{c.statusDate ? `${fmtDay(c.statusDate)} — ` : ""}{c.statusReason}</div>}
                <div className="ls-card-meta">
                  <div><span>{t("leases.terms")}</span><b>{c.paymentAmount && c.paymentEveryMonths ? t("leases.termsValue", { amount: fmt2(c.paymentAmount), count: c.paymentEveryMonths }) : "—"}</b></div>
                  <div><span>{t("leases.period")}</span><b>{fmtDay(c.startDate)} – {fmtDay(c.endDate)}</b></div>
                  <div><span>{t("leases.vatMode")}</span><b>{t(`leases.vatModes.${c.vatMode}`)}</b></div>
                  <div><span>{t("leases.screen.renewal")}</span><b>{c.noticeDays ? t("leases.noticeBy", { date: fmtDay(c.noticeDeadline), count: c.noticeDays }) : (c.autoRenew ? t("leases.autoRenewShort") : t("leases.noAutoRenewShort"))}</b></div>
                </div>
                <div className="ls-card-tags">
                  {c.brandName && <span className="ls-tag ls-tag-brand" style={{ "--b": c.brandColor || "#0D4A31" }}>{c.brandName}</span>}
                  {c.propertyDetails?.city && <span className="ls-tag">{c.propertyDetails.city}</span>}
                  {c.contractNumber && <span className="ls-tag">{t("leases.contractNumber")}: <bdi>{c.contractNumber}</bdi></span>}
                  {c.costCenterName && <span className="ls-tag">{c.costCenterName}</span>}
                  {!(c.expenseAccountId && c.prepaidAccountId) && <span className="ls-tag is-warn">{t("leases.accounts")}: {t("leases.accountsDefault")}</span>}
                  <span className={`ls-tag ${c.attachmentCount > 0 ? "is-ok" : "is-warn"}`}>{c.attachmentCount > 0 ? t("leases.screen.attachmentsN", { count: c.attachmentCount }) : t("leases.screen.noAttachment")}</span>
                </div>
                <div className="ls-card-actions">
                  <button className="ls-act is-primary" onClick={() => openView(c)}>{t("leases.screen.viewBtn")}</button>
                  <button className="ls-act" onClick={() => openContract(c)}>{t("common.edit")}</button>
                  <button className="ls-act" onClick={() => openStatus(c)}>{t("leases.contractStatus.btn")}</button>
                  <button className="ls-act" onClick={() => { setMessage(""); setNoticeFor(c); }}>{t("leases.notice.btn")}</button>
                  <button className="ls-act" onClick={() => open("newPayment", { leaseContractId: c.id, dueDate: localDay(), periodFrom: localDay(), periodTo: localDay(), amount: c.paymentAmount ?? "", note: "" })}>+ {t("leases.payment")}</button>
                  <button className="ls-act" onClick={() => open("generate", { id: c.id, title: c.title, until: c.endDate })} disabled={!c.paymentAmount || !c.paymentEveryMonths || !c.firstDueDate}>{t("leases.generate")}</button>
                  <button className="ls-act is-danger" onClick={() => removeContract(c)}>{t("common.delete")}</button>
                </div>
              </div>
            ))}
          </div>
          {data && contracts.length === 0 && <p className="empty">{t("leases.noContracts")}</p>}
          {contracts.length > 0 && shownContracts.length === 0 && <p className="empty">{t("leases.screen.noMatch")}</p>}
        </div>
      )}

      {view === "report" && (
        <LeaseReportView contracts={contracts} brands={brands} companyName={companyName} today={localDay()} t={t} i18n={i18n} fmtDay={fmtDay} />
      )}

      {view === "amortization" && (
        <>
          <div className="panel">
            <p className="note">{t("leases.amortization.note")}</p>
            <div className="filter-bar" style={{ maxWidth: 260 }}>
              <label>{t("leases.amortization.month")}<input type="month" value={amortMonth} onChange={(e) => e.target.value && setAmortMonth(e.target.value)} /></label>
            </div>
            {preview?.alreadyPosted && <p className="note">{t("leases.amortization.alreadyPosted", { amount: fmt2(preview.existingRun.totalAmount) })}</p>}
            {preview?.unpaid?.length > 0 && (
              <div role="status" style={{ background: "rgba(183,121,31,0.08)", border: "1px solid rgba(183,121,31,0.28)", borderRadius: 10, padding: "10px 14px", margin: "0 0 14px", fontSize: 13, color: "#7A5212" }}>
                ⚠ {t("leases.amortization.unpaid", { count: preview.unpaid.length })}: {preview.unpaid.map((u) => `${u.title} (${fmt2(u.amount)})`).join("، ")}
              </div>
            )}
            <div className="lines-table-wrap">
              <table className="ledger-table">
                <thead><tr>
                  <th>{t("leases.contract")}</th><th>{t("leases.period")}</th><th>{t("leases.amortization.net")}</th>
                  <th>{t("leases.amortization.already")}</th><th>{t("leases.amortization.thisMonth")}</th><th>{t("leases.amortization.remaining")}</th>
                </tr></thead>
                <tbody>
                  {(preview?.rows || []).map((r) => (
                    <tr key={r.leasePaymentId}>
                      <td>{r.title}</td><td>{fmtDay(r.periodFrom)} – {fmtDay(r.periodTo)}</td><td className="num">{fmt2(r.netAmount)}</td>
                      <td className="num">{fmt2(r.alreadyAmortized)}</td>
                      <td className="num strong">{fmt2(r.amount)}{r.amount !== r.monthShare && <div style={SUB}>{t("leases.amortization.catchUp")}</div>}</td>
                      <td className="num">{fmt2(r.remainingAfter)}</td>
                    </tr>
                  ))}
                  {preview && preview.rows.length === 0 && <tr><td className="empty" colSpan={6}>{t("leases.amortization.empty")}</td></tr>}
                </tbody>
                {preview?.rows.length > 0 && <tfoot><tr><td className="foot-label" colSpan={4}>{t("leases.amortization.total")}</td><td className="num strong">{fmt2(preview.total)}</td><td></td></tr></tfoot>}
              </table>
            </div>
            <div className="form-btn-group">
              <button className="btn-primary" disabled={!preview || preview.alreadyPosted || preview.rows.length === 0} onClick={() => run(() => api.postLeaseAmortization(companyId, amortMonth), "leases.amortization.postedOk")}>{t("leases.amortization.postBtn")}</button>
            </div>
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>{t("leases.amortization.runsTitle")}</h3>
            <table className="ledger-table">
              <thead><tr><th>{t("leases.amortization.month")}</th><th>{t("leases.amortization.total")}</th><th>{t("leases.entryNumber")}</th><th></th></tr></thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={r.id}>
                    <td>{fmtMonth(r.month)}</td><td className="num">{fmt2(r.totalAmount)}</td>
                    <td><Link to={routes.journalEntry(r.journalEntryId)}>{r.entryNumber}</Link></td>
                    <td className="row-actions">{i === 0 && <button className="btn-ghost" onClick={() => open("removeRun", { id: r.id, month: r.month, pin: "" })}>{t("leases.amortization.remove")}</button>}</td>
                  </tr>
                ))}
                {runs.length === 0 && <tr><td className="empty" colSpan={4}>{t("leases.amortization.noRuns")}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openMonth && (() => {
        const mc = monthCard(openMonth);
        return (
          <LeaseDialog open={!dialog} title={t("leases.cal.dueIn", { month: fmtMonthLong(openMonth) })} onClose={() => setOpenMonth(null)} tone="ejar" width={1100}>
            <p className="note">{t("leases.cal.panelNote", { count: mc.rows.length })}</p>
            <div className="ls-kpis ls-kpis-view">
              <div className="ls-kpi tone-blue"><div className="ls-kpi-label">{t("leases.kpi.due")}</div><div className="ls-kpi-value">{fmt2(mc.total)}</div></div>
              <div className="ls-kpi tone-green"><div className="ls-kpi-label">{t("leases.kpi.paid")}</div><div className="ls-kpi-value">{fmt2(mc.paid)}</div></div>
              <div className="ls-kpi tone-amber"><div className="ls-kpi-label">{t("leases.kpi.outstanding")}</div><div className="ls-kpi-value">{fmt2(mc.outstanding)}</div></div>
              {mc.overdueCount > 0 && <div className="ls-kpi tone-red"><div className="ls-kpi-label">{t("leases.kpi.overdue")}</div><div className="ls-kpi-value">{mc.overdueCount}</div></div>}
            </div>
            <div className="ls-due-list">
              {mc.rows.map((p) => {
                const c = contractOf(p.leaseContractId) || {};
                const tone = toneOf(p);
                return (
                  <div key={p.id} className={`ls-due pay-${tone}`}>
                    <div className="ls-due-date"><b>{formatDate(p.dueDate, i18n.language, { timeZone: "UTC", day: "numeric" })}</b><span>{formatDate(p.dueDate, i18n.language, { timeZone: "UTC", month: "short" })}</span></div>
                    <div className="ls-due-main">
                      <button type="button" className="ls-link" onClick={() => openView(c)}>{c.title}</button>
                      <span>{c.counterparty || "—"} · {t("leases.period")}: {fmtDay(p.periodFrom)} – {fmtDay(p.periodTo)}</span>
                    </div>
                    <div className="ls-due-amount"><b>{fmt2(p.amount)}</b><span>{t("leases.kpi.vat")}: {fmt2(p.vatAmount)}</span></div>
                    <span className={`ls-badge pay-${tone}`}>{t(`leases.statuses.${tone}`)}{p.status === "paid" && p.paidOn ? ` · ${fmtDay(p.paidOn)}` : ""}</span>
                    <button type="button" className={`ls-act${p.status === "paid" ? "" : " is-primary"}`} onClick={() => openPayment(p)}>{p.status === "paid" ? t("leases.cal.details") : t("leases.cal.pay")}</button>
                  </div>
                );
              })}
              {mc.rows.length === 0 && <p className="empty">{t("leases.cal.noDue")}</p>}
            </div>
            {mc.held > 0 && <p className="ls-month-panel-foot">{t("leases.cal.heldNote", { count: mc.held })}</p>}
            <div className="form-btn-group"><button className="btn-ghost" onClick={() => setOpenMonth(null)}>{t("common.close")}</button></div>
          </LeaseDialog>
        );
      })()}

      <LeaseDialog open={dialog === "view"} title={`${t("leases.screen.viewTitle")} — ${form.title || ""}`} onClose={close} tone="ejar" width={1100}>
        {form.contract && (() => {
          const c = form.contract;
          const lessor = c.lessorDetails || {};
          const property = c.propertyDetails || {};
          const row = (label, value) => (value || value === 0) && <div className="ls-dl-row" key={label}><span>{label}</span><b>{value}</b></div>;
          return (
            <>
              <div className="ls-view-top">
                <span className={`ls-badge st-${statusOf(c)}`}>{t(`leases.contractStatus.${statusOf(c)}`)}</span>
                {statusOf(c) !== "active" && c.statusReason && <span className="ls-view-reason">{c.statusReason}</span>}
                <span className="ls-view-spacer" />
                <button className="ls-act" onClick={() => openContract(c)}>{t("common.edit")}</button>
                <button className="ls-act" onClick={() => openStatus(c)}>{t("leases.contractStatus.btn")}</button>
                <button className="ls-act" onClick={() => { close(); setNoticeFor(c); }}>{t("leases.notice.btn")}</button>
              </div>
              {form.totals && (
                <div className="ls-kpis ls-kpis-view">
                  {[["scheduled", "blue"], ["paid", "green"], ["outstanding", "amber"], ["onHold", "gray"], ["overdue", "red"]].map(([k, tone]) => (
                    <div key={k} className={`ls-kpi tone-${tone}`}><div className="ls-kpi-label">{t(`leases.screen.totals.${k}`)}</div><div className="ls-kpi-value">{fmt2(form.totals[k] || 0)}</div></div>
                  ))}
                </div>
              )}
              <div className="ls-view-grid">
                <section className="ls-section">
                  <h4>{t("leases.screen.contractData")}</h4>
                  {row(t("leases.counterparty"), c.counterparty)}
                  {row(t("leases.brands.label"), c.brandName)}
                  {row(t("leases.contractNumber"), c.contractNumber && <bdi>{c.contractNumber}</bdi>)}
                  {row(t("leases.signedOn"), c.signedOn && fmtDay(c.signedOn))}
                  {row(t("leases.period"), `${fmtDay(c.startDate)} – ${fmtDay(c.endDate)}`)}
                  {row(t("leases.contractValue"), c.contractValue != null && fmt2(c.contractValue))}
                  {row(t("leases.depositAmount"), c.depositAmount != null && fmt2(c.depositAmount))}
                  {row(t("leases.terms"), c.paymentAmount && c.paymentEveryMonths ? t("leases.termsValue", { amount: fmt2(c.paymentAmount), count: c.paymentEveryMonths }) : null)}
                  {row(t("leases.vatMode"), t(`leases.vatModes.${c.vatMode}`))}
                  {row(t("leases.screen.renewal"), c.autoRenew ? t("leases.autoRenewShort") : t("leases.noAutoRenewShort"))}
                  {row(t("leases.noticeDays"), c.noticeDays ? t("leases.noticeBy", { date: fmtDay(c.noticeDeadline), count: c.noticeDays }) : null)}
                  {row(t("leases.costCenter"), c.costCenterName)}
                  {row(t("leases.notes"), c.notes)}
                </section>
                <section className="ls-section">
                  <h4>{t("leases.lessorTitle")}</h4>
                  {row(t("leases.lessor.type"), lessor.type && t(`leases.lessor.${lessor.type}`))}
                  {LESSOR_FIELDS.map((k) => row(t(`leases.lessor.${k}`), lessor[k] && <bdi>{lessor[k]}</bdi>))}
                  <h4 className="ls-section-next">{t("leases.propertyTitle")}</h4>
                  {PROPERTY_FIELDS.map((k) => row(t(`leases.property.${k}`), property[k]))}
                </section>
              </div>
              {c.customTerms && <section className="ls-section"><h4>{t("leases.customTerms")}</h4><div className="ls-terms">{c.customTerms}</div></section>}
              <section className="ls-section">
                <h4>{t("leases.screen.schedule")} {form.payments?.length ? `(${form.payments.length})` : ""}</h4>
                {form.loading && <p className="empty">…</p>}
                {!form.loading && (
                  <div className="lines-table-wrap">
                    <table className="ledger-table ls-table">
                      <thead><tr><th>{t("leases.dueDate")}</th><th>{t("leases.period")}</th><th>{t("leases.amount")}</th><th>{t("leases.kpi.vat")}</th><th>{t("leases.status")}</th><th>{t("leases.notes")}</th></tr></thead>
                      <tbody>
                        {(form.payments || []).map((p) => (
                          <tr key={p.id}>
                            <td>{fmtDay(p.dueDate)}</td><td>{fmtDay(p.periodFrom)} – {fmtDay(p.periodTo)}</td>
                            <td className="num strong">{fmt2(p.amount)}</td><td className="num">{fmt2(p.vatAmount)}</td>
                            <td><span className={`ls-badge pay-${p.onHold ? "hold" : toneOf(p)}`}>{p.onHold ? t("leases.screen.onHold") : t(`leases.statuses.${toneOf(p)}`)}</span>{p.status === "paid" && p.paidOn ? <span className="ls-sub"> {fmtDay(p.paidOn)}{p.postedExternally ? ` · ${t("leases.externalBadge")}` : ""}</span> : null}</td>
                            <td>{p.entryNumber ? <Link to={routes.journalEntry(p.journalEntryId)}>{p.entryNumber}</Link> : ""}{p.note ? ` ${p.note}` : ""}</td>
                          </tr>
                        ))}
                        {(form.payments || []).length === 0 && <tr><td className="empty" colSpan={6}>{t("leases.screen.noPayments")}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              {(c.statusHistory || []).length > 0 && (
                <section className="ls-section">
                  <h4>{t("leases.contractStatus.history")}</h4>
                  <div className="ld-history">
                    {[...c.statusHistory].reverse().map((h, i) => (
                      <div key={i} className={`ld-history-item st-${h.status}`}><span className="ld-dot" /><span className="ld-history-date">{fmtDay(h.effectiveDate)}</span><span className="ld-history-status">{t(`leases.contractStatus.${h.status}`)}</span><span>{h.reason || ""}</span></div>
                    ))}
                  </div>
                </section>
              )}
              <section className="ls-section ls-attachments">
                <AttachmentsPanel entityType="lease_contract" entityId={c.id} title={t("leases.screen.attachmentsTitle")} onChange={load} />
              </section>
            </>
          );
        })()}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.close")}</button></div>
      </LeaseDialog>

      <LeaseDialog open={dialog === "contract"} title={form.id ? t("leases.editContract") : t("leases.newContract")} onClose={close} tone="gold" width={1040}>
        <div className="form-grid">
          <label>{t("leases.contractTitle")}<input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>{t("leases.counterparty")}<input value={form.counterparty || ""} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} /></label>
          <label>{t("leases.brands.label")}
            <select value={form.brandId || ""} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
              <option value="">{t("leases.brands.none")}</option>
              {brands.filter((b) => b.isActive || b.id === form.brandId).map((b) => <option key={b.id} value={b.id}>{b.name}{b.nameEn ? ` — ${b.nameEn}` : ""}</option>)}
            </select>
          </label>
          <label>{t("leases.property.city")}<input value={form.property?.city || ""} onChange={(e) => setForm({ ...form, property: { ...form.property, city: e.target.value } })} /></label>
          <label>{t("leases.costCenter")}
            <select value={form.costCenterId || ""} onChange={(e) => setForm({ ...form, costCenterId: e.target.value })}>
              <option value="">—</option>
              {companyCostCenters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{t("leases.vatMode")}
            <select value={form.vatMode || "none"} onChange={(e) => setForm({ ...form, vatMode: e.target.value })}>
              <option value="none">{t("leases.vatModes.none")}</option><option value="inclusive">{t("leases.vatModes.inclusive")}</option>
            </select>
          </label>
          <label>{t("leases.startDate")}<input type="date" value={form.startDate || ""} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
          <label>{t("leases.endDate")}<input type="date" value={form.endDate || ""} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
          <label>{t("leases.paymentAmount")}<input type="number" step="0.01" min="0" value={form.paymentAmount ?? ""} onChange={(e) => setForm({ ...form, paymentAmount: e.target.value })} /></label>
          <label>{t("leases.everyMonths")}<input type="number" step="1" min="1" value={form.paymentEveryMonths ?? ""} onChange={(e) => setForm({ ...form, paymentEveryMonths: e.target.value })} /></label>
          <label>{t("leases.firstDueDate")}<input type="date" value={form.firstDueDate || ""} onChange={(e) => setForm({ ...form, firstDueDate: e.target.value })} /></label>
          <label>{t("leases.contractNumber")}<input value={form.contractNumber || ""} onChange={(e) => setForm({ ...form, contractNumber: e.target.value })} /></label>
          <label>{t("leases.signedOn")}<input type="date" value={form.signedOn || ""} onChange={(e) => setForm({ ...form, signedOn: e.target.value })} /></label>
          <label>{t("leases.contractValue")}<input type="number" step="0.01" min="0" value={form.contractValue ?? ""} onChange={(e) => setForm({ ...form, contractValue: e.target.value })} /></label>
          <label>{t("leases.depositAmount")}<input type="number" step="0.01" min="0" value={form.depositAmount ?? ""} onChange={(e) => setForm({ ...form, depositAmount: e.target.value })} /></label>
          <label>{t("leases.noticeDays")}<input type="number" step="1" min="0" value={form.noticeDays ?? ""} onChange={(e) => setForm({ ...form, noticeDays: e.target.value })} /></label>
          <label className="ld-switch"><input type="checkbox" checked={!!form.autoRenew} onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })} />{t("leases.autoRenew")}</label>
          <h4 className="sub-head" style={{ gridColumn: "1 / -1", margin: "6px 0 0" }}>{t("leases.lessorTitle")}</h4>
          <label>{t("leases.lessor.type")}
            <select value={form.lessor?.type || ""} onChange={(e) => setForm({ ...form, lessor: { ...form.lessor, type: e.target.value } })}>
              <option value="">—</option><option value="company">{t("leases.lessor.company")}</option><option value="individual">{t("leases.lessor.individual")}</option>
            </select>
          </label>
          {LESSOR_FIELDS.map((k) => (
            <label key={k}>{t(`leases.lessor.${k}`)}<input value={form.lessor?.[k] || ""} onChange={(e) => setForm({ ...form, lessor: { ...form.lessor, [k]: e.target.value } })} /></label>
          ))}
          <h4 className="sub-head" style={{ gridColumn: "1 / -1", margin: "6px 0 0" }}>{t("leases.propertyTitle")}</h4>
          {PROPERTY_FIELDS.filter((k) => k !== "city").map((k) => (
            <label key={k}>{t(`leases.property.${k}`)}<input value={form.property?.[k] || ""} onChange={(e) => setForm({ ...form, property: { ...form.property, [k]: e.target.value } })} /></label>
          ))}
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.customTerms")}<textarea rows={3} style={{ width: "100%" }} value={form.customTerms || ""} onChange={(e) => setForm({ ...form, customTerms: e.target.value })} /></label>
          <h4 className="sub-head" style={{ gridColumn: "1 / -1", margin: "6px 0 0" }}>{t("leases.accounts")}</h4>
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.prepaidAccount")}
            <AccountSearchSelect accounts={postingAccounts} value={form.prepaidAccountId} onChange={(id) => setForm({ ...form, prepaidAccountId: id })} allowClear />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.expenseAccount")}
            <AccountSearchSelect accounts={postingAccounts} value={form.expenseAccountId} onChange={(id) => setForm({ ...form, expenseAccountId: id })} allowClear />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.notes")}<input value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        </div>
        <p className="note">{t("leases.accountsHint")}</p>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" onClick={saveContract}>{t("common.save")}</button></div>
      </LeaseDialog>

      <LeaseDialog open={dialog === "contractStatus"} title={`${t("leases.contractStatus.title")} — ${form.title || ""}`} onClose={close} tone="amber" width={820}>
        <p className="note">{t("leases.contractStatus.note")}</p>
        <div className="ld-section-title">{t("leases.contractStatus.label")}</div>
        <div className="ld-tiles">
          {CONTRACT_STATUSES.map((st) => (
            <button key={st} type="button" className={`ld-tile st-${st}${(form.status || "active") === st ? " is-on" : ""}`} onClick={() => setForm({ ...form, status: st })}>
              <span className="ld-tile-name"><span className="ld-dot" />{t(`leases.contractStatus.${st}`)}{form.current === st ? ` · ${t("leases.contractStatus.currentTag")}` : ""}</span>
              <span className="ld-tile-hint">{t(`leases.contractStatus.hint.${st}`)}</span>
            </button>
          ))}
        </div>
        <div className="ld-row">
          <label>{t("leases.contractStatus.effectiveDate")}<input type="date" value={form.effectiveDate || ""} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></label>
        </div>
        <label>{t("leases.contractStatus.reason")}<textarea rows={3} placeholder={t("leases.contractStatus.reasonPlaceholder")} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        {(form.history || []).length > 0 && (
          <>
            <div className="ld-section-title">{t("leases.contractStatus.history")}</div>
            <div className="ld-history">
              {[...form.history].reverse().map((h, i) => (
                <div key={i} className={`ld-history-item st-${h.status}`}>
                  <span className="ld-dot" /><span className="ld-history-date">{fmtDay(h.effectiveDate)}</span>
                  <span className="ld-history-status">{t(`leases.contractStatus.${h.status}`)}</span><span>{h.reason || ""}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button>
          <button className="btn-primary" disabled={form.status !== "active" && (form.reason || "").trim().length < 3} onClick={() => run(() => api.setLeaseContractStatus(form.id, { status: form.status, reason: (form.reason || "").trim() || null, effectiveDate: form.effectiveDate || undefined }), "leases.contractStatus.savedOk")}>{t("common.save")}</button>
        </div>
      </LeaseDialog>

      <LeaseDialog open={dialog === "accounts"} title={t("leases.accountsBtn")} onClose={close} tone="info" width={820}>
        <p className="note">{t("leases.accountsDialogNote")}</p>
        <label>{t("leases.prepaidAccount")}<AccountSearchSelect accounts={postingAccounts} value={form.prepaidAccountId} onChange={(id) => setForm({ ...form, prepaidAccountId: id })} allowClear /></label>
        <label>{t("leases.expenseAccount")}<AccountSearchSelect accounts={postingAccounts} value={form.expenseAccountId} onChange={(id) => setForm({ ...form, expenseAccountId: id })} allowClear /></label>
        <label className="ld-switch"><input type="checkbox" checked={!!form.onlyMissing} onChange={(e) => setForm({ ...form, onlyMissing: e.target.checked })} />{t("leases.onlyMissing")}</label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button>
          <button className="btn-primary" disabled={!form.expenseAccountId && !form.prepaidAccountId} onClick={() => run(() => api.applyLeaseAccounts({ companyId, expenseAccountId: form.expenseAccountId || null, prepaidAccountId: form.prepaidAccountId || null, onlyMissing: !!form.onlyMissing }), "leases.accountsAppliedOk")}>{t("common.save")}</button>
        </div>
      </LeaseDialog>

      <LeaseDialog open={dialog === "reminder"} title={t("leases.reminder.title")} onClose={close} tone="info" width={780}>
        <p className="note">{t("leases.reminder.note")}</p>
        <label className="ld-switch"><input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />{t("leases.reminder.enabled")}</label>
        <label>{t("leases.reminder.hour")}
          <span className="ld-time">
            <select value={form.hourKsa ?? 8} onChange={(e) => setForm({ ...form, hourKsa: e.target.value })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}</option>)}
            </select>
            :
            <select value={form.minuteKsa ?? 0} onChange={(e) => setForm({ ...form, minuteKsa: e.target.value })}>
              {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
            </select>
          </span>
        </label>
        <label>{t("leases.reminder.emails")}<textarea rows={4} style={{ direction: "ltr" }} value={form.emails || ""} onChange={(e) => setForm({ ...form, emails: e.target.value })} /></label>
        {!(form.emails || "").trim() && <p className="note">{t("leases.reminder.defaultRecipients")}: <span style={{ direction: "ltr", unicodeBidi: "embed" }}>{(form.effective || []).join(", ") || "—"}</span></p>}
        {form.lastSentAt && <p className="note">{t("leases.reminder.lastSent")}: {fmtDay(form.lastSentAt)}</p>}
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-ghost" onClick={sendReminderNow}>{t("leases.reminder.sendNow")}</button><button className="btn-primary" onClick={saveReminder}>{t("common.save")}</button></div>
      </LeaseDialog>

      <LeaseDialog open={dialog === "generate"} title={`${t("leases.generate")} — ${form.title || ""}`} onClose={close} tone="green" width={640}>
        <p className="note">{t("leases.generateNote")}</p>
        <label>{t("leases.generateUntil")}<input type="date" value={form.until || ""} onChange={(e) => setForm({ ...form, until: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" onClick={() => run(() => api.generateLeaseSchedule(form.id, form.until || undefined), "leases.generatedOk")}>{t("leases.generate")}</button></div>
      </LeaseDialog>

      <LeaseDialog open={dialog === "newPayment"} title={`+ ${t("leases.payment")} — ${formContract?.title || ""}`} onClose={close} tone="green" width={780}>
        <div className="form-grid">
          <label>{t("leases.dueDate")}<input type="date" value={form.dueDate || ""} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
          <label>{t("leases.amount")}<input type="number" step="0.01" min="0" value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
          <label>{t("leases.periodFrom")}<input type="date" value={form.periodFrom || ""} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} /></label>
          <label>{t("leases.periodTo")}<input type="date" value={form.periodTo || ""} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} /></label>
          <label style={{ gridColumn: "1 / -1" }}>{t("leases.notes")}<input value={form.note || ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        </div>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" onClick={saveNewPayment}>{t("common.save")}</button></div>
      </LeaseDialog>

      <LeaseDialog open={dialog === "payment"} title={`${formContract?.title || ""} — ${form.dueDate ? fmtDay(form.dueDate) : ""}`} onClose={close} tone="gold" width={900}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, background: "var(--athar-bg)", border: "1px solid var(--athar-border)", borderRadius: 10, padding: "10px 14px", margin: "0 26px 18px" }}>
          <div><div style={SUB}>{t("leases.status")}</div><strong>{t(`leases.statuses.${form.status ? toneOf(form) : "due"}`)}</strong></div>
          <div><div style={SUB}>{t("leases.amount")}</div><strong>{fmt2(form.amount || 0)}</strong></div>
          <div><div style={SUB}>{t("leases.kpi.vat")}</div><strong>{fmt2(form.vatAmount || 0)}</strong></div>
          <div><div style={SUB}>{t("leases.period")}</div><strong style={{ fontSize: 12.5 }}>{form.periodFrom ? `${fmtDay(form.periodFrom)} – ${fmtDay(form.periodTo)}` : ""}</strong></div>
        </div>

        {form.status === "paid" && (
          <>
            <p className="note">
              {t("leases.paidOn")}: {fmtDay(form.paidOn)}
              {form.postedExternally ? ` · ${t("leases.externalBadge")}` : ""}
              {form.entryNumber && <> · {t("leases.entryNumber")}: <Link to={routes.journalEntry(form.journalEntryId)}>{form.entryNumber}</Link></>}
              {form.reference ? ` · ${form.reference}` : ""}
            </p>
            {form.note && <p className="note">{form.note}</p>}
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.close")}</button><button className="btn-ghost" onClick={() => open("reverse", { id: form.id, reason: "" })}>{t("leases.reverse")}</button></div>
          </>
        )}

        {form.status === "waived" && (
          <>
            {form.note && <p className="note">{form.note}</p>}
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.close")}</button><button className="btn-ghost" onClick={removePayment}>{t("common.delete")}</button><button className="btn-primary" onClick={() => setWaived(false)}>{t("leases.unwaive")}</button></div>
          </>
        )}

        {form.status === "due" && form.mode === "view" && (
          <>
            <div className="form-grid">
              <label>{t("leases.paidOn")}<input type="date" value={form.paidOnInput || ""} onChange={(e) => setForm({ ...form, paidOnInput: e.target.value })} /></label>
              <label>{t("leases.paidAmount")}<input type="number" step="0.01" min="0" value={form.amountInput ?? ""} onChange={(e) => setForm({ ...form, amountInput: e.target.value })} /></label>
              {!form.external && (
                <label style={{ gridColumn: "1 / -1" }}>{t("leases.bankAccount")}
                  <AccountSearchSelect accounts={bankAccounts} value={form.bankAccountId} onChange={(id) => setForm({ ...form, bankAccountId: id })} />
                </label>
              )}
              <label>{t("leases.reference")}<input value={form.referenceInput || ""} onChange={(e) => setForm({ ...form, referenceInput: e.target.value })} /></label>
              <label>{t("leases.notes")}<input value={form.noteInput || ""} onChange={(e) => setForm({ ...form, noteInput: e.target.value })} /></label>
              <label className="ld-switch" style={{ gridColumn: "1 / -1" }}><input type="checkbox" checked={!!form.external} onChange={(e) => setForm({ ...form, external: e.target.checked })} />{t("leases.external")}</label>
              {form.external && <label>{t("leases.amortizeFrom")}<input type="month" value={form.amortizeFromMonth || ""} onChange={(e) => setForm({ ...form, amortizeFromMonth: e.target.value })} /></label>}
            </div>
            <p className="note">{form.external ? t("leases.externalNote") : t("leases.entryNote", { net: fmt2(previewGross - previewVat), vat: fmt2(previewVat), gross: fmt2(previewGross) })}</p>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group" style={{ flexWrap: "wrap" }}>
              <button className="btn-ghost" onClick={close}>{t("common.cancel")}</button>
              <button className="btn-ghost" onClick={() => setForm({ ...form, mode: "edit" })}>{t("common.edit")}</button>
              <button className="btn-ghost" onClick={() => setWaived(true)}>{t("leases.waive")}</button>
              <button className="btn-primary" onClick={confirmPayment}>{t("leases.confirm")}</button>
            </div>
          </>
        )}

        {form.status === "due" && form.mode === "edit" && (
          <>
            <div className="form-grid">
              <label>{t("leases.dueDate")}<input type="date" value={form.editDueDate || ""} onChange={(e) => setForm({ ...form, editDueDate: e.target.value })} /></label>
              <label>{t("leases.amount")}<input type="number" step="0.01" min="0" value={form.amountInput ?? ""} onChange={(e) => setForm({ ...form, amountInput: e.target.value })} /></label>
              <label>{t("leases.periodFrom")}<input type="date" value={form.editFrom || ""} onChange={(e) => setForm({ ...form, editFrom: e.target.value })} /></label>
              <label>{t("leases.periodTo")}<input type="date" value={form.editTo || ""} onChange={(e) => setForm({ ...form, editTo: e.target.value })} /></label>
              <label style={{ gridColumn: "1 / -1" }}>{t("leases.notes")}<input value={form.noteInput || ""} onChange={(e) => setForm({ ...form, noteInput: e.target.value })} /></label>
            </div>
            {error && <p className="balance-bad">{error}</p>}
            <div className="form-btn-group"><button className="btn-ghost" onClick={() => setForm({ ...form, mode: "view" })}>{t("common.cancel")}</button><button className="btn-ghost" onClick={removePayment}>{t("common.delete")}</button><button className="btn-primary" onClick={savePaymentEdit}>{t("common.save")}</button></div>
          </>
        )}
      </LeaseDialog>

      <LeaseDialog open={dialog === "reverse"} title={t("leases.reverseTitle")} onClose={close} tone="red" width={680}>
        <p className="note">{t("leases.reverseNote")}</p>
        <label>{t("leases.reverseReason")}<textarea rows={3} value={form.reason || ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" onClick={saveReverse}>{t("leases.reverse")}</button></div>
      </LeaseDialog>

      <LeaseDialog open={dialog === "removeRun"} title={`${t("leases.amortization.remove")} — ${form.month ? fmtMonth(form.month) : ""}`} onClose={close} tone="red" width={640}>
        <p className="note">{t("leases.amortization.removeNote")}</p>
        <label>{t("leases.amortization.pin")}<input type="password" autoComplete="off" value={form.pin || ""} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></label>
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group"><button className="btn-ghost" onClick={close}>{t("common.cancel")}</button><button className="btn-primary" disabled={!form.pin} onClick={() => run(() => api.removeLeaseAmortizationRun(form.id, form.pin), "leases.amortization.removedOk")}>{t("leases.amortization.remove")}</button></div>
      </LeaseDialog>
      <LeaseBrandsDialog open={brandsOpen} onClose={() => setBrandsOpen(false)} companyId={companyId} brands={brands} onChanged={() => Promise.all([loadBrands(), load()])} t={t} />
      {noticeFor && <LeaseNoticeDialog contract={noticeFor} onClose={() => setNoticeFor(null)} onDone={(msg) => { setNoticeFor(null); setMessage(msg); }} t={t} fmtDay={fmtDay} />}
    </div>
  );
}
