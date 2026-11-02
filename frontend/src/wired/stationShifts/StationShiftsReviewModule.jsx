import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../i18n/dateFormat";
import * as api from "../../api/stationShifts";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";
import { useModuleTab } from "../shared/useModuleTab";
import { fmt } from "../../legacy/constants";
import StationWorkersTab from "./StationWorkersTab";
import StationSetupTab from "./StationSetupTab";
import FuelPricesTab from "./FuelPricesTab";

export const STATION_SHIFTS_TABS = [
  { id: "pending", labelKey: "stationShiftsReview.tabTitle" },
  { id: "setup", labelKey: "stationSetup.tabTitle" },
  { id: "prices", labelKey: "fuelPrices.tabTitle" },
  { id: "workers", labelKey: "stationWorkers.tabTitle" },
];

const EXTRA_TABS = { setup: StationSetupTab, prices: FuelPricesTab, workers: StationWorkersTab };

/**
 * شاشة المحاسب لمراجعة/اعتماد/ترحيل ورديات المحطات — محور العامل منفصل تماماً في بوابة الموظف
 * (frontend/src/mobile/screens/StationShiftScreen.jsx). لا صلة بالشاشة المؤقتة القديمة
 * (StationShiftsTestPanel.jsx، حُذفت بالكامل) — هذه شاشة حقيقية ضمن التنقّل الرئيسي، تظهر فقط
 * لشركة نشاطها "محطات وقود" (راجع App.jsx).
 *
 * الفرق المالي (عجز/زيادة الصندوق) والقيد المرتقب (computeShiftClosing عبر getShiftById) يظهران
 * حصراً هنا — لا مسار آخر في كل النظام يكشفهما لأي صلاحية عامل، راجع تعليق getShiftSummary في
 * stationShifts.service.ts.
 */
export default function StationShiftsReviewModule({ companyId }) {
  const { t, i18n } = useTranslation();
  const [tab] = useModuleTab("/stationShifts", STATION_SHIFTS_TABS);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [corrections, setCorrections] = useState({});
  // "pending" = قيد المراجعة، "posted" = المرحَّلة والمعكوسة (حيث زر عكس الوردية — صلاحية الترحيل)
  const [view, setView] = useState("pending");
  const [posted, setPosted] = useState([]);

  const loadPending = () => api.listPendingShifts(companyId).then(setPending).catch((e) => setError(e.message));
  const loadPosted = () => api.listPostedShifts(companyId).then(setPosted).catch((e) => setError(e.message));
  const reloadList = () => (view === "posted" ? loadPosted() : loadPending());
  useEffect(() => { reloadList(); }, [companyId, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = view === "posted" ? posted : pending;

  const loadDetail = (id) => {
    setError(""); setSelectedId(id);
    api.getShiftById(id).then(setDetail).catch((e) => setError(e.message));
  };

  const doCorrect = async (readingId) => {
    setError(""); setMessage("");
    try {
      await api.correctReading(selectedId, readingId, Number(corrections[readingId] || 0));
      loadDetail(selectedId);
    } catch (e) { setError(e.message); }
  };

  const doApprove = async () => {
    setError(""); setMessage("");
    try { await api.approveShift(selectedId); setMessage(t("stationShiftsReview.approvedMsg")); loadDetail(selectedId); loadPending(); }
    catch (e) { setError(e.message); }
  };

  const doPost = async () => {
    setError(""); setMessage("");
    try { await api.postShift(selectedId); setMessage(t("stationShiftsReview.postedMsg")); loadDetail(selectedId); loadPending(); }
    catch (e) { setError(e.message); }
  };

  // عكس وردية مرحَّلة: قيد عكسي + إلغاء صرف الوقود + حالة "معكوسة" — السبب إلزامي، ولا يُعاد ترحيلها بعدها
  const doReverse = async () => {
    const reason = window.prompt(t("stationShiftsReview.reversePrompt"));
    if (!reason || !reason.trim()) return;
    setError(""); setMessage("");
    try { await api.reverseShift(selectedId, reason.trim()); setMessage(t("stationShiftsReview.reversedMsg")); loadDetail(selectedId); reloadList(); }
    catch (e) { setError(e.message); }
  };

  // وردية مصحَّحة بدل وردية معكوسة/مرفوضة: قراءة إغلاق لكل فوهة (الافتتاح من الوردية المستبدَلة في الخادم)
  const [correctedClosings, setCorrectedClosings] = useState({});
  const doCreateCorrected = async () => {
    setError(""); setMessage("");
    const readings = (detail.readings || []).map((r) => ({ nozzleId: r.nozzleId, closingReading: Number(correctedClosings[r.id] ?? r.accountantConfirmedValue ?? r.closingReading ?? "") }));
    if (readings.some((r) => !Number.isFinite(r.closingReading))) { setError(t("stationShiftsReview.correctedMissingReading")); return; }
    try {
      const created = await api.createCorrectedShift(selectedId, { readings });
      setMessage(t("stationShiftsReview.correctedCreatedMsg"));
      setCorrectedClosings({});
      setView("pending");
      loadDetail(created.id);
    } catch (e) { setError(e.message); }
  };

  const doReject = async () => {
    const reasonCode = window.prompt(t("stationShiftsReview.rejectPrompt"));
    if (!reasonCode) return;
    setError(""); setMessage("");
    try { await api.rejectShift(selectedId, reasonCode); setMessage(t("stationShiftsReview.rejectedMsg")); loadDetail(selectedId); loadPending(); }
    catch (e) { setError(e.message); }
  };

  const header = (
    <>
      <div className="section-title">
        <Breadcrumb parts={[t("stationShiftsReview.breadcrumb")]} />
        <h2>{t("stationShiftsReview.title")}</h2>
      </div>
      <SubTabs tabs={STATION_SHIFTS_TABS.map((x) => ({ ...x, label: t(x.labelKey) }))} active={tab} basePath="/stationShifts" />
    </>
  );

  const ExtraTab = EXTRA_TABS[tab];
  if (ExtraTab) {
    return (
      <div>
        {header}
        <ExtraTab companyId={companyId} />
      </div>
    );
  }

  return (
    <div>
      {header}

      {error && <p className="balance-bad">{error}</p>}
      {message && <p className="note">{message}</p>}

      <div className="panel">
        <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{t(view === "posted" ? "stationShiftsReview.postedTitle" : "stationShiftsReview.pendingTitle")}</h3>
          <div className="form-btn-group">
            <button className={view === "pending" ? "btn-primary" : "btn-ghost"} onClick={() => setView("pending")}>{t("stationShiftsReview.viewPending")}</button>
            <button className={view === "posted" ? "btn-primary" : "btn-ghost"} onClick={() => setView("posted")}>{t("stationShiftsReview.viewPosted")}</button>
            <button className="btn-ghost" onClick={reloadList}>{t("stationShiftsReview.refreshBtn")}</button>
          </div>
        </div>
        <table className="ledger-table">
          <thead>
            <tr>
              <th>{t("stationShiftsReview.table.employee")}</th>
              <th>{t("stationShiftsReview.table.station")}</th>
              <th>{t("stationShiftsReview.table.shiftType")}</th>
              <th>{t("stationShiftsReview.table.date")}</th>
              <th>{t("stationShiftsReview.table.status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} style={{ background: s.id === selectedId ? "#f0f4ff" : undefined }}>
                <td>{s.employee?.name}</td>
                <td>{s.costCenter?.name}</td>
                <td>{t(`stationShiftsReview.shiftType.${s.shiftType}`)}</td>
                <td>{formatDate(s.shiftDate, i18n.language)}</td>
                <td>{t(`stationShiftsReview.status.${s.status}`)}</td>
                <td><button className="btn-ghost" onClick={() => loadDetail(s.id)}>{t("stationShiftsReview.openBtn")}</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td className="empty" colSpan={6}>{t(view === "posted" ? "stationShiftsReview.noPosted" : "stationShiftsReview.noPending")}</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="panel">
          <h3>{t("stationShiftsReview.detailTitle", { employee: detail.employee?.name, status: t(`stationShiftsReview.status.${detail.status}`) })}</h3>

          <h4>{t("stationShiftsReview.readingsTitle")}</h4>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("stationShiftsReview.table.nozzle")}</th>
                <th>{t("stationShiftsReview.table.product")}</th>
                <th>{t("stationShiftsReview.table.openingReading")}</th>
                <th>{t("stationShiftsReview.table.confirmedReading")}</th>
                <th>{t("stationShiftsReview.correctionLabel")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(detail.readings || []).map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>{r.nozzle?.pumpNumber}-{r.nozzle?.nozzleNumber}</td>
                    <td>{r.nozzle?.product ? t(`stationSetup.products.${r.nozzle.product}`) : ""}</td>
                    <td><span className="num">{r.openingReading}</span>{r.nozzle?.meterDigits ? <span className="station-digits-hint">{t("stationShiftsReview.digitsSuffix", { n: r.nozzle.meterDigits })}</span> : null}</td>
                    <td className="num">{r.accountantConfirmedValue ?? t("stationShiftsReview.notReviewedYet")}</td>
                    <td><input type="number" value={corrections[r.id] || ""} onChange={(e) => setCorrections({ ...corrections, [r.id]: e.target.value })} style={{ width: 100 }} /></td>
                    <td><button className="btn-ghost" onClick={() => doCorrect(r.id)}>{t("stationShiftsReview.correctBtn")}</button></td>
                  </tr>
                  <tr>
                    <td colSpan={6}>
                      <AttachmentsPanel entityType="station_shift_reading" entityId={r.id} title={t("stationShiftsReview.meterPhotoTitle", { nozzle: `${r.nozzle?.pumpNumber}-${r.nozzle?.nozzleNumber}` })} />
                    </td>
                  </tr>
                </React.Fragment>
              ))}
              {(!detail.readings || detail.readings.length === 0) && <tr><td className="empty" colSpan={5}>{t("stationShiftsReview.noReadings")}</td></tr>}
            </tbody>
          </table>

          <h4>{t("stationShiftsReview.expensesTitle")}</h4>
          <table className="ledger-table">
            <thead><tr><th>{t("stationShiftsReview.table.description")}</th><th>{t("stationShiftsReview.table.amount")}</th></tr></thead>
            <tbody>
              {(detail.expenses || []).map((exp) => (
                <React.Fragment key={exp.id}>
                  <tr>
                    <td>{exp.description || exp.category}</td>
                    <td className="num">{fmt(exp.amount)}</td>
                  </tr>
                  <tr>
                    <td colSpan={2}>
                      <AttachmentsPanel entityType="station_shift_expense" entityId={exp.id} title={t("stationShiftsReview.receiptPhotoTitle")} />
                    </td>
                  </tr>
                </React.Fragment>
              ))}
              {(!detail.expenses || detail.expenses.length === 0) && <tr><td className="empty" colSpan={2}>{t("stationShiftsReview.noExpenses")}</td></tr>}
            </tbody>
          </table>

          <h4>{t("stationShiftsReview.netCashTitle")}</h4>
          {detail.summary ? (
            <table className="ledger-table">
              <tbody>
                <tr><td>{t("stationShiftsReview.grossSales")}</td><td className="num">{fmt(detail.summary.grossSales)}</td></tr>
                <tr><td>{t("stationShiftsReview.expensesTotal")}</td><td className="num">{fmt(detail.summary.expensesTotal)}</td></tr>
                <tr><td>{t("stationShiftsReview.expectedCash")}</td><td className="num">{fmt(detail.summary.expectedCash)}</td></tr>
                <tr><td>{t("stationShiftsReview.cashDue")}</td><td className="num">{fmt(detail.summary.cashDue)}</td></tr>
                <tr className={Number(detail.summary.variance) < 0 ? "balance-bad" : "balance-ok"}>
                  <td className="strong">{t("stationShiftsReview.variance")}</td>
                  <td className="num strong">{fmt(detail.summary.variance)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="note">{t("stationShiftsReview.pendingConfirmation")}</p>
          )}

          {detail.summary && (
            <>
              <h4>{t(detail.summary.linesSource === "posted" ? "stationShiftsReview.journalPostedTitle" : "stationShiftsReview.journalPreviewTitle")}</h4>
              {detail.summary.cogsError && <p className="balance-bad">{t("stationShiftsReview.cogsErrorPrefix")} {detail.summary.cogsError}</p>}
              <table className="ledger-table">
                <thead><tr><th>{t("stationShiftsReview.table.account")}</th><th>{t("stationShiftsReview.table.debit")}</th><th>{t("stationShiftsReview.table.credit")}</th></tr></thead>
                <tbody>
                  {detail.summary.lines.map((l, i) => {
                    const acc = (detail.summary.accounts || []).find((a) => a.id === l.accountId);
                    const name = acc ? `${acc.code} — ${i18n.language === "en" && acc.nameEn ? acc.nameEn : acc.name}` : l.accountId;
                    return (
                      <tr key={i}>
                        <td>{name}{l.lineDescription ? <span className="note"> ({l.lineDescription})</span> : null}</td>
                        <td className="num">{l.debit ? fmt(l.debit) : ""}</td>
                        <td className="num">{l.credit ? fmt(l.credit) : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {detail.status === "rejected" || detail.status === "reversed" ? (
            <div>
              <h4>{t("stationShiftsReview.correctedTitle")}</h4>
              <p className="note">{t("stationShiftsReview.correctedNote")}</p>
              <table className="ledger-table">
                <thead><tr><th>{t("stationShiftsReview.table.nozzle")}</th><th>{t("stationShiftsReview.table.openingReading")}</th><th>{t("stationShiftsReview.correctedClosingLabel")}</th></tr></thead>
                <tbody>
                  {(detail.readings || []).map((r) => (
                    <tr key={r.id}>
                      <td>{r.nozzle?.pumpNumber}-{r.nozzle?.nozzleNumber}</td>
                      <td className="num">{r.openingReading}</td>
                      <td>
                        <input
                          type="number"
                          value={correctedClosings[r.id] ?? r.accountantConfirmedValue ?? r.closingReading ?? ""}
                          onChange={(e) => setCorrectedClosings({ ...correctedClosings, [r.id]: e.target.value })}
                          style={{ width: 140 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="form-btn-group">
                <button className="btn-primary" onClick={doCreateCorrected}>{t("stationShiftsReview.correctedCreateBtn")}</button>
                {detail.status === "reversed" && <p className="note">{t("stationShiftsReview.reversedNote")}</p>}
              </div>
            </div>
          ) : detail.status === "posted" ? (
            <div className="form-btn-group">
              <button className="btn-ghost" onClick={doReverse}>{t("stationShiftsReview.reverseBtn")}</button>
            </div>
          ) : (
            <div className="form-btn-group">
              <button className="btn-primary" disabled={!detail.summary} onClick={doApprove}>{t("stationShiftsReview.approveBtn")}</button>
              <button className="btn-primary" onClick={doPost}>{t("stationShiftsReview.postBtn")}</button>
              <button className="btn-ghost" onClick={doReject}>{t("stationShiftsReview.rejectBtn")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
