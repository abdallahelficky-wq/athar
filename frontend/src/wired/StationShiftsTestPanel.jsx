import React, { useEffect, useState } from "react";
import * as stationShiftsApi from "../api/stationShifts";
import AttachmentsPanel from "./shared/AttachmentsPanel";

/**
 * شاشة اختبار مؤقتة وغير مصقولة (لا جزء من الميزة النهائية) — الهدف الوحيد منها تمكين تجربة تدفّق
 * ورديات المحطات فعلياً (عامل يفتح وردية ويسجّل قراءات ← محاسب يراجع ويعتمد ويرحّل) قبل بناء
 * الشاشات الحقيقية، لأن فرع feature/station-shifts لا يملك أي واجهة لهذا التدفّق بعد (فقط
 * REST API + إعدادات الشركة + شاشة المناصب). تُستدعى المسارات الحقيقية مباشرة بلا أي محاكاة.
 */
export default function StationShiftsTestPanel() {
  const [tab, setTab] = useState("worker");
  return (
    <div>
      <div className="section-title">
        <h2>اختبار وحدة ورديات المحطات (شاشة مؤقتة للاختبار فقط)</h2>
      </div>
      <p className="note">
        هذه ليست شاشة نهائية — واجهة بسيطة بلا أي تصميم لاستدعاء الـ API الحقيقي مباشرة، حتى يمكن
        تجربة التدفّق كاملاً (فتح وردية ← تسجيل قراءات ← إرسال ← مراجعة/اعتماد/ترحيل) قبل بناء
        الشاشات الحقيقية.
      </p>
      <div className="form-btn-group" style={{ marginBottom: 16 }}>
        <button className={tab === "worker" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("worker")}>عامل المحطة</button>
        <button className={tab === "accountant" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("accountant")}>المحاسب (مراجعة / اعتماد / ترحيل)</button>
      </div>
      {tab === "worker" ? <WorkerPanel /> : <AccountantPanel />}
    </div>
  );
}

function WorkerPanel() {
  const [station, setStation] = useState(null);
  const [error, setError] = useState("");
  const [shiftType, setShiftType] = useState("morning");
  const [shiftId, setShiftId] = useState("");
  const [resumeShiftId, setResumeShiftId] = useState("");
  const [readingForms, setReadingForms] = useState({});
  const [readingResults, setReadingResults] = useState({});
  const [collections, setCollections] = useState({ networkAmount: "0", fuelCardAmount: "0", cashDelivered: "0" });
  const [summary, setSummary] = useState(null);
  const [message, setMessage] = useState("");

  const loadStation = () => stationShiftsApi.getMyStation().then(setStation).catch((e) => setError(e.message));
  useEffect(loadStation, []);

  const setField = (nozzleId, field, value) =>
    setReadingForms((prev) => ({ ...prev, [nozzleId]: { ...prev[nozzleId], [field]: value } }));

  const doOpenShift = async () => {
    setError(""); setMessage("");
    try {
      const shift = await stationShiftsApi.openShift(shiftType);
      setShiftId(shift.id);
      setMessage(`تم فتح وردية جديدة — رقمها (احتفظ به لو أعدت تحميل الصفحة): ${shift.id}`);
    } catch (e) { setError(e.message); }
  };

  const useExistingShift = () => {
    if (!resumeShiftId.trim()) return;
    setShiftId(resumeShiftId.trim());
    setMessage(`تم استخدام الوردية ${resumeShiftId.trim()} — تابع تسجيل القراءات أدناه.`);
  };

  const doSubmitReading = async (nozzleId) => {
    setError(""); setMessage("");
    const form = readingForms[nozzleId] || {};
    try {
      const reading = await stationShiftsApi.submitReading(shiftId, {
        nozzleId,
        closingReading: Number(form.closingReading || 0),
        testLiters: Number(form.testLiters || 0),
        workerConfirmedValue: Number(form.workerConfirmedValue || form.closingReading || 0),
        capturedAt: new Date().toISOString(),
      });
      setReadingResults((prev) => ({ ...prev, [nozzleId]: reading }));
      setMessage(`تم حفظ قراءة الفوهة — لا تنسَ رفع صورة العداد أدناه (مطلوبة قبل الاعتماد).`);
    } catch (e) { setError(e.message); }
  };

  const doUpdateCollections = async () => {
    setError(""); setMessage("");
    try {
      await stationShiftsApi.updateCollections(shiftId, {
        networkAmount: Number(collections.networkAmount || 0),
        fuelCardAmount: Number(collections.fuelCardAmount || 0),
        cashDelivered: Number(collections.cashDelivered || 0),
      });
      setMessage("تم حفظ بيانات التحصيل.");
    } catch (e) { setError(e.message); }
  };

  const doGetSummary = async () => {
    setError("");
    try { setSummary(await stationShiftsApi.getShiftSummary(shiftId)); }
    catch (e) { setError(e.message); }
  };

  const doSubmitShift = async () => {
    setError(""); setMessage("");
    try {
      await stationShiftsApi.submitShift(shiftId);
      setMessage("تم إرسال الوردية للمراجعة — انتقل لتبويب المحاسب للمتابعة.");
    } catch (e) { setError(e.message); }
  };

  if (error) return <div className="panel"><p className="balance-bad">{error}</p></div>;
  if (!station) return <p className="empty">جارٍ التحميل...</p>;

  return (
    <div className="panel">
      {message && <p className="note">{message}</p>}

      <h3>1) فتح وردية</h3>
      <div className="form-btn-group">
        <label>نوع الوردية
          <select value={shiftType} onChange={(e) => setShiftType(e.target.value)}>
            <option value="morning">صباحية</option>
            <option value="night">مسائية</option>
          </select>
        </label>
        <button className="btn-primary" onClick={doOpenShift} disabled={!!shiftId}>فتح وردية جديدة</button>
      </div>
      <div className="form-btn-group" style={{ marginTop: 8 }}>
        <label>أو استئناف وردية مفتوحة بالفعل برقمها
          <input value={resumeShiftId} onChange={(e) => setResumeShiftId(e.target.value)} placeholder="Shift ID" style={{ minWidth: 260 }} />
        </label>
        <button className="btn-ghost" onClick={useExistingShift}>استخدام هذا الرقم</button>
      </div>
      {shiftId && <p><strong>الوردية الحالية:</strong> {shiftId}</p>}

      {shiftId && (
        <>
          <h3>2) قراءات الفوهات</h3>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>المضخة</th><th>الفوهة</th><th>المنتج</th><th>آخر قراءة إغلاق</th><th>السعر الساري</th>
                <th>قراءة الإغلاق الجديدة</th><th>لتر الاختبار</th><th>القيمة المؤكَّدة من العامل</th><th></th>
              </tr>
            </thead>
            <tbody>
              {station.nozzles.map((n) => {
                const form = readingForms[n.id] || {};
                const result = readingResults[n.id];
                return (
                  <React.Fragment key={n.id}>
                    <tr>
                      <td>{n.pumpNumber}</td>
                      <td>{n.nozzleNumber}</td>
                      <td>{n.product}</td>
                      <td className="num">{station.previousClosingReadings[n.id] ?? 0}</td>
                      <td className="num">{station.effectivePrices[n.product] ?? "غير مضبوط"}</td>
                      <td><input type="number" value={form.closingReading || ""} onChange={(e) => setField(n.id, "closingReading", e.target.value)} style={{ width: 100 }} /></td>
                      <td><input type="number" value={form.testLiters || ""} onChange={(e) => setField(n.id, "testLiters", e.target.value)} style={{ width: 80 }} /></td>
                      <td><input type="number" value={form.workerConfirmedValue || ""} onChange={(e) => setField(n.id, "workerConfirmedValue", e.target.value)} style={{ width: 100 }} /></td>
                      <td><button className="btn-ghost" onClick={() => doSubmitReading(n.id)}>حفظ القراءة</button></td>
                    </tr>
                    {result && (
                      <tr>
                        <td colSpan={9}>
                          <AttachmentsPanel entityType="station_shift_reading" entityId={result.id} title={`صورة عداد الفوهة ${n.nozzleNumber} (مطلوبة قبل الاعتماد)`} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          <h3>3) التحصيل</h3>
          <div className="form-btn-group">
            <label>شبكة نقاط البيع (مدى)<input type="number" value={collections.networkAmount} onChange={(e) => setCollections({ ...collections, networkAmount: e.target.value })} style={{ width: 120 }} /></label>
            <label>بطاقات الوقود/الأسطول<input type="number" value={collections.fuelCardAmount} onChange={(e) => setCollections({ ...collections, fuelCardAmount: e.target.value })} style={{ width: 120 }} /></label>
            <label>النقدية المُسلَّمة<input type="number" value={collections.cashDelivered} onChange={(e) => setCollections({ ...collections, cashDelivered: e.target.value })} style={{ width: 120 }} /></label>
            <button className="btn-ghost" onClick={doUpdateCollections}>حفظ التحصيل</button>
          </div>

          <h3>4) الملخص الحي والإرسال</h3>
          <div className="form-btn-group">
            <button className="btn-ghost" onClick={doGetSummary}>عرض الملخص الحي</button>
            <button className="btn-primary" onClick={doSubmitShift}>إرسال الوردية للمراجعة</button>
          </div>
          {summary && <pre style={{ direction: "ltr", textAlign: "left", overflowX: "auto" }}>{JSON.stringify(summary, null, 2)}</pre>}
        </>
      )}
    </div>
  );
}

function AccountantPanel() {
  const [pending, setPending] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [corrections, setCorrections] = useState({});

  const loadPending = () => stationShiftsApi.listPendingShifts().then(setPending).catch((e) => setError(e.message));
  useEffect(loadPending, []);

  const loadDetail = (id) => {
    setError(""); setSelectedId(id);
    stationShiftsApi.getShiftById(id).then(setDetail).catch((e) => setError(e.message));
  };

  const doCorrect = async (readingId) => {
    setError(""); setMessage("");
    try {
      await stationShiftsApi.correctReading(selectedId, readingId, Number(corrections[readingId] || 0));
      loadDetail(selectedId);
    } catch (e) { setError(e.message); }
  };

  const doApprove = async () => {
    setError(""); setMessage("");
    try { await stationShiftsApi.approveShift(selectedId); setMessage("تم اعتماد الوردية (بدون قيد محاسبي بعد)."); loadDetail(selectedId); loadPending(); }
    catch (e) { setError(e.message); }
  };

  const doPost = async () => {
    setError(""); setMessage("");
    try { await stationShiftsApi.postShift(selectedId); setMessage("تم ترحيل الوردية — أُنشئ القيد المحاسبي."); loadDetail(selectedId); loadPending(); }
    catch (e) { setError(e.message); }
  };

  const doReject = async () => {
    const reasonCode = window.prompt("سبب الرفض (نص قصير):", "بيانات غير صحيحة");
    if (!reasonCode) return;
    setError(""); setMessage("");
    try { await stationShiftsApi.rejectShift(selectedId, reasonCode); setMessage("تم رفض الوردية."); loadDetail(selectedId); loadPending(); }
    catch (e) { setError(e.message); }
  };

  return (
    <div className="panel">
      {error && <p className="balance-bad">{error}</p>}
      {message && <p className="note">{message}</p>}

      <div className="form-btn-group" style={{ justifyContent: "space-between" }}>
        <h3>الورديات قيد المراجعة</h3>
        <button className="btn-ghost" onClick={loadPending}>تحديث</button>
      </div>
      <table className="ledger-table">
        <thead><tr><th>رقم الوردية</th><th>النوع</th><th>التاريخ</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
          {pending.map((s) => (
            <tr key={s.id} style={{ background: s.id === selectedId ? "#f0f4ff" : undefined }}>
              <td>{s.id}</td><td>{s.shiftType}</td><td>{new Date(s.shiftDate).toLocaleDateString()}</td><td>{s.status}</td>
              <td><button className="btn-ghost" onClick={() => loadDetail(s.id)}>فتح</button></td>
            </tr>
          ))}
          {pending.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد ورديات قيد المراجعة حالياً</td></tr>}
        </tbody>
      </table>

      {detail && (
        <>
          <h3>تفاصيل الوردية {detail.id} — الحالة: {detail.status}</h3>

          <h4>القراءات</h4>
          <table className="ledger-table">
            <thead><tr><th>الفوهة</th><th>المنتج</th><th>قراءة العامل</th><th>قيمة مؤكَّدة من العامل</th><th>تصحيح المحاسب</th><th></th></tr></thead>
            <tbody>
              {(detail.readings || []).map((r) => (
                <React.Fragment key={r.id}>
                  <tr>
                    <td>{r.nozzle?.nozzleNumber}</td>
                    <td>{r.nozzle?.product}</td>
                    <td className="num">{r.closingReading}</td>
                    <td className="num">{r.accountantConfirmedValue ?? r.workerConfirmedValue}</td>
                    <td><input type="number" value={corrections[r.id] || ""} onChange={(e) => setCorrections({ ...corrections, [r.id]: e.target.value })} style={{ width: 100 }} /></td>
                    <td><button className="btn-ghost" onClick={() => doCorrect(r.id)}>تصحيح</button></td>
                  </tr>
                  <tr>
                    <td colSpan={6}>
                      <AttachmentsPanel entityType="station_shift_reading" entityId={r.id} title={`صورة عداد الفوهة ${r.nozzle?.nozzleNumber}`} />
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>

          <h4>الملخص الحسابي</h4>
          <pre style={{ direction: "ltr", textAlign: "left", overflowX: "auto" }}>{JSON.stringify(detail.summary, null, 2)}</pre>

          <h4>سجل التدقيق</h4>
          <ul>
            {(detail.auditLogs || []).map((a) => (
              <li key={a.id}>{a.action} — {a.fieldName}: {a.oldValue} ← {a.newValue} ({new Date(a.createdAt).toLocaleString()})</li>
            ))}
          </ul>

          <div className="form-btn-group">
            <button className="btn-primary" onClick={doApprove}>اعتماد الوردية</button>
            <button className="btn-primary" onClick={doPost}>ترحيل الوردية (إنشاء القيد)</button>
            <button className="btn-ghost" onClick={doReject}>رفض الوردية</button>
          </div>
        </>
      )}
    </div>
  );
}
