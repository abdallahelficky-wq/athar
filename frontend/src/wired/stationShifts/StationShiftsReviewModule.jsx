import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api/stationShifts";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import Breadcrumb from "../shared/Breadcrumb";
import SubTabs from "../shared/SubTabs";
import { useModuleTab } from "../shared/useModuleTab";
import { fmt } from "../../legacy/constants";

export const STATION_SHIFTS_TABS = [{ id: "pending", labelKey: "stationShiftsReview.tabTitle" }];

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
  const { t } = useTranslation();
  const [tab] = useModuleTab("/stationShifts", STATION_SHIFTS_TABS);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [corrections, setCorrections] = useState({});

  const loadPending = () => api.listPendingShifts(companyId).then(setPending).catch((e) => setError(e.message));
  useEffect(() => { loadPending(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const doReject = async () => {
    const reasonCode = window.prompt(t("stationShiftsReview.rejectPrompt"));
    if (!reasonCode) return;
    setError(""); setMessage("");
    try { await api.rejectShift(selectedId, reasonCode); setMessage(t("stationShiftsReview.rejectedMsg")); loadDetail(selectedId); loadPending(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div>
      <div className="section-title">
        <Breadcrumb parts={[t("stationShiftsReview.breadcrumb")]} />
        <h2>{t("stationShiftsReview.title")}</h2>
      </div>
      <SubTabs tabs={STATION_SHIFTS_TABS.map((x) => ({ ...x, label: t(x.labelKey) }))} active={tab} basePath="/stationShifts" />

      {error && <p className="balance-bad">{error}</p>}
      {message && <p className="note">{message}</p>}

      <div className="panel">
        <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{t("stationShiftsReview.pendingTitle")}</h3>
          <button className="btn-ghost" onClick={loadPending}>{t("stationShiftsReview.refreshBtn")}</button>
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
            {pending.map((s) => (
              <tr key={s.id} style={{ background: s.id === selectedId ? "#f0f4ff" : undefined }}>
                <td>{s.employee?.name}</td>
                <td>{s.costCenter?.name}</td>
                <td>{t(`stationShiftsReview.shiftType.${s.shiftType}`)}</td>
                <td>{new Date(s.shiftDate).toLocaleDateString()}</td>
                <td>{t(`stationShiftsReview.status.${s.status}`)}</td>
                <td><button className="btn-ghost" onClick={() => loadDetail(s.id)}>{t("stationShiftsReview.openBtn")}</button></td>
              </tr>
            ))}
            {pending.length === 0 && <tr><td className="empty" colSpan={6}>{t("stationShiftsReview.noPending")}</td></tr>}
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
                    <td>{r.nozzle?.product}</td>
                    <td className="num">{r.accountantConfirmedValue ?? t("stationShiftsReview.notReviewedYet")}</td>
                    <td><input type="number" value={corrections[r.id] || ""} onChange={(e) => setCorrections({ ...corrections, [r.id]: e.target.value })} style={{ width: 100 }} /></td>
                    <td><button className="btn-ghost" onClick={() => doCorrect(r.id)}>{t("stationShiftsReview.correctBtn")}</button></td>
                  </tr>
                  <tr>
                    <td colSpan={5}>
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

          <div className="form-btn-group">
            <button className="btn-primary" disabled={!detail.summary} onClick={doApprove}>{t("stationShiftsReview.approveBtn")}</button>
            <button className="btn-primary" onClick={doPost}>{t("stationShiftsReview.postBtn")}</button>
            <button className="btn-ghost" onClick={doReject}>{t("stationShiftsReview.rejectBtn")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
