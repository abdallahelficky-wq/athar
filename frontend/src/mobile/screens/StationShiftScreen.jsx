import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../api/stationShiftsPortal";

const OPEN_SHIFT_STORAGE_KEY = "athar.mobile.stationShifts.openShiftId";

/**
 * شاشة عامل المحطة (بوابة الموظف) — تصوير عداد كل فوهة فقط، بلا أي إدخال رقمي من العامل إطلاقاً:
 * لا حقل قراءة، لا تأكيد قيمة. المحاسب هو من يكتب القيمة الفعلية أثناء المراجعة (شاشة المراجعة في
 * التطبيق الرئيسي)، إلى أن تُفعَّل قراءة العداد آلياً من الصورة (OCR) كمرحلة لاحقة منفصلة تماماً.
 * الفوهات تُعرض مجمَّعة حسب المضخة (pumpNumber) — كل مضخة بعدد فوهاتها الفعلي، لا عدداً ثابتاً.
 *
 * المحطة الآلية (station.automated — متحكم PTS-2 وكل الفوهات مربوطة): لا تصوير إطلاقاً. القراءات تُنشأ عند الفتح وتُقفَل
 * من عدادات الجهاز عند الإقفال؛ الشاشة تعرض مبيعات الوردية حتى اللحظة (تتحدّث كل 15 ثانية): لترات ومبلغ لكل منتج والإجمالي. وشاشتها مختصرة لأربع خطوات فقط: فتح الوردية، الشبكة، الكاش، إقفال
 * الوردية — بلا مصروفات ولا حفظ منفصل للتحصيل: زر الإقفال يحفظ الشبكة والكاش ثم يقفل (بضغطة تأكيد ثانية).
 *
 * shiftId يُحفَظ في localStorage (لا نقطة نهاية لاسترجاع "ورديتي المفتوحة" في هذه المرحلة) حتى لا
 * يُفقَد التقدّم عند إغلاق المتصفح/تحديث الصفحة أثناء وردية حقيقية في محطة وقود.
 */
function groupNozzlesByPump(nozzles) {
  const byPump = new Map();
  for (const n of nozzles) {
    if (!byPump.has(n.pumpNumber)) byPump.set(n.pumpNumber, []);
    byPump.get(n.pumpNumber).push(n);
  }
  return [...byPump.entries()];
}
const fmt = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** وردية آلية مفتوحة: لكل منتج اللترات والمبلغ، ثم الإجمالي (بسعر المحطة الساري). */
function AutomatedSales({ sales, t }) {
  const row = (label, liters, amount, strong) => (
    <div className="m-list-row" style={strong ? { fontWeight: 700, borderTop: "1px solid #e5e7eb", paddingTop: 8 } : undefined}>
      <span>{label}</span>
      <span><bdi>{fmt(liters)}</bdi> L · <bdi>{amount == null ? "—" : fmt(amount)}</bdi> {t("mobile.stationShifts.sar")}</span>
    </div>
  );
  return (
    <div className="m-card">
      <h4 style={{ marginTop: 0, color: "#2F5D5A" }}>● {t("mobile.stationShifts.shiftOpenTitle")}</h4>
      {(sales?.products || []).map((p) => <React.Fragment key={p.product}>{row(t(`stationSetup.products.${p.product}`), p.liters, p.amount)}</React.Fragment>)}
      {row(t("mobile.stationShifts.totalSales"), sales?.liters, sales?.amount, true)}
    </div>
  );
}

/** رسائل المشرف لمحطة العامل — تظهر أعلى الشاشة؛ الجديدة (لم تُرَ قبل هذا الجلب) مميَّزة. */
function SupervisorMessages({ t }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    const load = () => api.getMessages().then(setList).catch(() => {});
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(timer);
  }, []);
  const [showAll, setShowAll] = useState(false);
  if (list.length === 0) return null;
  const shown = showAll ? list : list.slice(0, 2);
  return (
    <div className="m-card" style={{ borderInlineStart: "4px solid #1971c2" }}>
      <h4 style={{ marginTop: 0 }}>✉ {t("mobile.stationShifts.messagesTitle")}</h4>
      {shown.map((m) => (
        <div key={m.id} className="m-list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 2, fontWeight: m.seenAt ? 400 : 700 }}>
          <span>{!m.seenAt && "● "}{m.body}</span>
          <span style={{ fontSize: 11.5, color: "#6b7280", fontWeight: 400 }}>{m.from || ""} · {new Date(m.createdAt).toLocaleString("en-GB", { calendar: "gregory", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      ))}
      {list.length > 2 && <button className="m-logout-link" onClick={() => setShowAll(!showAll)}>{showAll ? t("mobile.stationShifts.messagesLess") : t("mobile.stationShifts.messagesMore")}</button>}
    </div>
  );
}

export default function StationShiftScreen() {
  const { t } = useTranslation();
  const [station, setStation] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [shiftType, setShiftType] = useState("morning");
  const [shiftId, setShiftId] = useState(() => localStorage.getItem(OPEN_SHIFT_STORAGE_KEY) || "");
  const [readings, setReadings] = useState({}); // nozzleId -> { value, readingId, photoName }
  const [network, setNetwork] = useState("");
  const [cashDelivered, setCashDelivered] = useState("");
  const [collectionsSaved, setCollectionsSaved] = useState(false);
  const [expenses, setExpenses] = useState([]); // { id, amount, description, photoName }
  const [newExpense, setNewExpense] = useState({ amount: "", description: "", file: null });
  const [busy, setBusy] = useState(false);
  const [sales, setSales] = useState(null); // وردية آلية: { liters, nozzles[] } من الخادم
  const [confirmClose, setConfirmClose] = useState(false);
  const expenseFileRef = useRef(null);

  const loadStation = () => api.getMyStation().then(setStation).catch((e) => setError(e.message));
  useEffect(() => { loadStation(); }, []);

  // عند استئناف وردية محفوظة (تحديث الصفحة/إغلاق المتصفح أثناء العمل)، اجلب ما سبق حفظه فعلياً
  // (القراءات/التحصيل/المصروفات) حتى لا تظهر الشاشة وكأن كل شيء ضائع رغم أن الخادم يحتفظ به —
  // بلا هذا، كانت إعادة حفظ نفس القراءة تعمل بأمان (upsert) لكنها تجربة استخدام سيئة تطلب من
  // العامل تصوير كل فوهة مجدداً بلا داعٍ فقط لأن حالة React المحلية بدأت فارغة من جديد.
  useEffect(() => {
    if (!shiftId) return;
    api.getShiftSummary(shiftId).then((summary) => {
      if (summary.status && summary.status !== "open") { persistShiftId(""); return; }
      setSales(summary.sales || null);
      const restored = {};
      for (const r of summary.readings || []) {
        restored[r.nozzleId] = { readingId: r.id, saved: true, photoName: null };
      }
      setReadings(restored);
      if (summary.collection) {
        setNetwork(String(summary.collection.networkAmount ?? ""));
        setCashDelivered(String(summary.collection.cashDelivered ?? ""));
        setCollectionsSaved(true);
      }
      setExpenses((summary.expenses || []).map((e) => ({ id: e.id, amount: e.amount, description: e.description })));
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId]);

  const automated = Boolean(station?.automated);
  // وردية آلية: لتراتها حتى اللحظة من عدادات المتحكم
  useEffect(() => {
    if (!shiftId || !automated) return undefined;
    const tick = () => api.getShiftSummary(shiftId).then((s) => setSales(s.sales || null)).catch(() => {});
    const timer = setInterval(tick, 15000);
    return () => clearInterval(timer);
  }, [shiftId, automated]);

  const persistShiftId = (id) => {
    setShiftId(id);
    if (id) localStorage.setItem(OPEN_SHIFT_STORAGE_KEY, id);
    else localStorage.removeItem(OPEN_SHIFT_STORAGE_KEY);
  };

  const doOpenShift = async () => {
    setError(""); setMessage("");
    try {
      const shift = await api.openShift(shiftType);
      persistShiftId(shift.id);
      // الخادم لا يفتح وردية إلا على محطة لها مضخات — لكن قائمة الفوهات هنا حُمِّلت عند فتح الشاشة، وقد
      // تكون أُضيفت المضخات بعدها (شاشة مفتوحة منذ الصباح)؛ إعادة الجلب تمنع وردية تظهر بلا فوهات.
      await loadStation();
    } catch (e) { setError(e.message); }
  };

  const onNozzlePhoto = (nozzleId, file) => {
    if (!file) return;
    setReadings((prev) => ({ ...prev, [nozzleId]: { ...prev[nozzleId], file, photoName: file.name } }));
  };

  const saveReading = async (nozzleId) => {
    setError(""); setMessage("");
    const entry = readings[nozzleId] || {};
    if (!entry.file) return setError(t("mobile.stationShifts.photoRequired"));
    setBusy(true);
    try {
      const reading = await api.submitReading(shiftId, { nozzleId, capturedAt: new Date().toISOString() });
      await api.uploadReadingPhoto(shiftId, reading.id, entry.file);
      setReadings((prev) => ({ ...prev, [nozzleId]: { ...prev[nozzleId], readingId: reading.id, saved: true } }));
      setMessage(t("mobile.stationShifts.readingSaved"));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const saveCollections = async () => {
    setError(""); setMessage("");
    if (cashDelivered === "") return setError(t("mobile.stationShifts.cashRequired"));
    setBusy(true);
    try {
      await api.updateCollections(shiftId, {
        networkAmount: Number(network || 0),
        fuelCardAmount: 0,
        cashDelivered: Number(cashDelivered),
      });
      setCollectionsSaved(true);
      setMessage(t("mobile.stationShifts.collectionsSaved"));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const addExpense = async () => {
    setError(""); setMessage("");
    if (!newExpense.file) return setError(t("mobile.stationShifts.photoRequired"));
    if (!newExpense.amount || !newExpense.description.trim()) return setError(t("mobile.stationShifts.expenseFieldsRequired"));
    setBusy(true);
    try {
      const expense = await api.addExpense(shiftId, {
        amount: Number(newExpense.amount),
        category: newExpense.description.trim(),
        description: newExpense.description.trim(),
      });
      await api.uploadExpensePhoto(shiftId, expense.id, newExpense.file);
      setExpenses((prev) => [...prev, { id: expense.id, amount: newExpense.amount, description: newExpense.description }]);
      setNewExpense({ amount: "", description: "", file: null });
      if (expenseFileRef.current) expenseFileRef.current.value = "";
      setMessage(t("mobile.stationShifts.expenseSaved"));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const doSubmitShift = async () => {
    setError(""); setMessage("");
    const missing = automated ? [] : (station?.nozzles || []).filter((n) => !readings[n.id]?.saved);
    if (missing.length > 0) return setError(t("mobile.stationShifts.incompleteNozzles"));
    if (automated && cashDelivered === "") return setError(t("mobile.stationShifts.cashRequired"));
    if (!automated && !collectionsSaved) return setError(t("mobile.stationShifts.collectionsRequired"));
    // إقفال الوردية الآلية نهائي (يُثبِّت عدادات اللحظة) — ضغطة تأكيد ثانية
    if (automated && !confirmClose) return setConfirmClose(true);
    setBusy(true);
    try {
      // الآلية: الشبكة والكاش يُحفظان مع الإقفال نفسه (لا زر حفظ منفصل)
      if (automated) await api.updateCollections(shiftId, { networkAmount: Number(network || 0), fuelCardAmount: 0, cashDelivered: Number(cashDelivered) });
      await api.submitShift(shiftId);
      persistShiftId("");
      setReadings({}); setNetwork(""); setCashDelivered(""); setCollectionsSaved(false); setExpenses([]); setSales(null); setConfirmClose(false);
      setMessage(t(automated ? "mobile.stationShifts.shiftClosed" : "mobile.stationShifts.shiftSubmitted"));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!station) return error ? <p className="m-error">{error}</p> : <p className="m-empty">{t("common.loading")}</p>;

  if (!shiftId) {
    return (
      <div>
        <SupervisorMessages t={t} />
        {error && <p className="m-error">{error}</p>}
        <div className="m-card">
          <h4 style={{ marginTop: 0 }}>{t("mobile.stationShifts.openShiftTitle")}</h4>
          {automated && <p className="m-empty" style={{ textAlign: "start" }}>{t("mobile.stationShifts.automatedHint")}</p>}
          <div className="m-field">
            <label>{t("mobile.stationShifts.shiftTypeLabel")}</label>
            <select value={shiftType} onChange={(e) => setShiftType(e.target.value)}>
              <option value="morning">{t("mobile.stationShifts.morning")}</option>
              <option value="night">{t("mobile.stationShifts.night")}</option>
            </select>
          </div>
          <button className="m-btn" disabled={busy} onClick={doOpenShift}>{t("mobile.stationShifts.openShiftBtn")}</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SupervisorMessages t={t} />
      {error && <p className="m-error">{error}</p>}
      {message && <p className="m-empty" style={{ color: "#2F5D5A" }}>{message}</p>}

      {automated ? <AutomatedSales sales={sales} t={t} /> : <h4>{t("mobile.stationShifts.nozzlesTitle")}</h4>}
      {!automated && groupNozzlesByPump(station.nozzles).map(([pumpNumber, nozzles]) => (
        <div key={pumpNumber} className="m-card">
          <h4 style={{ marginTop: 0 }}>{t("mobile.stationShifts.pumpLabel", { pump: pumpNumber })}</h4>
          {nozzles.map((n) => {
            const entry = readings[n.id] || {};
            return (
              <div key={n.id} className="m-list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <strong>{t("mobile.stationShifts.nozzleLabel", { nozzle: n.nozzleNumber, product: t(`stationSetup.products.${n.product}`) })}</strong>
                {entry.saved ? (
                  <span style={{ color: "#2F5D5A" }}>✓ {t("mobile.stationShifts.readingSaved")}</span>
                ) : (
                  <>
                    <label className="m-btn" style={{ display: "inline-block", textAlign: "center" }}>
                      {entry.photoName ? t("mobile.stationShifts.retakePhoto") : t("mobile.stationShifts.takePhoto")}
                      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onNozzlePhoto(n.id, e.target.files?.[0])} />
                    </label>
                    {entry.photoName && <span style={{ fontSize: 12.5, color: "#6b7280" }}>{entry.photoName}</span>}
                    <button className="m-btn" disabled={busy} onClick={() => saveReading(n.id)}>{t("common.save")}</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="m-card">
        <h4 style={{ marginTop: 0 }}>{t("mobile.stationShifts.collectionsTitle")}</h4>
        {automated ? (
          <>
            <div className="m-field">
              <label>{t("mobile.stationShifts.networkLabel")}</label>
              <input type="number" inputMode="decimal" value={network} onChange={(e) => { setNetwork(e.target.value); setConfirmClose(false); }} />
            </div>
            <div className="m-field">
              <label>{t("mobile.stationShifts.cashDeliveredLabel")}</label>
              <input type="number" inputMode="decimal" value={cashDelivered} onChange={(e) => { setCashDelivered(e.target.value); setConfirmClose(false); }} />
            </div>
          </>
        ) : collectionsSaved ? (
          <span style={{ color: "#2F5D5A" }}>✓ {t("mobile.stationShifts.collectionsSaved")}</span>
        ) : (
          <>
            <div className="m-field">
              <label>{t("mobile.stationShifts.networkLabel")}</label>
              <input type="number" value={network} onChange={(e) => setNetwork(e.target.value)} />
            </div>
            <div className="m-field">
              <label>{t("mobile.stationShifts.cashDeliveredLabel")}</label>
              <input type="number" value={cashDelivered} onChange={(e) => setCashDelivered(e.target.value)} />
            </div>
            <button className="m-btn" disabled={busy} onClick={saveCollections}>{t("common.save")}</button>
          </>
        )}
      </div>

      {!automated && <div className="m-card">
        <h4 style={{ marginTop: 0 }}>{t("mobile.stationShifts.expensesTitle")}</h4>
        {expenses.map((exp) => (
          <div key={exp.id} className="m-list-row">
            <span>{exp.description}</span>
            <span>{exp.amount}</span>
          </div>
        ))}
        {expenses.length === 0 && <p className="m-empty">{t("mobile.stationShifts.noExpenses")}</p>}
        <div style={{ marginTop: 10 }}>
          <label className="m-btn" style={{ display: "inline-block", textAlign: "center" }}>
            {newExpense.file ? newExpense.file.name : t("mobile.stationShifts.addExpensePhotoBtn")}
            <input ref={expenseFileRef} type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => setNewExpense((prev) => ({ ...prev, file: e.target.files?.[0] || null }))} />
          </label>
          <div className="m-field">
            <label>{t("mobile.stationShifts.expenseDescriptionLabel")}</label>
            <input value={newExpense.description} onChange={(e) => setNewExpense((prev) => ({ ...prev, description: e.target.value }))} />
          </div>
          <div className="m-field">
            <label>{t("mobile.stationShifts.expenseAmountLabel")}</label>
            <input type="number" value={newExpense.amount} onChange={(e) => setNewExpense((prev) => ({ ...prev, amount: e.target.value }))} />
          </div>
          <button className="m-btn" disabled={busy} onClick={addExpense}>{t("mobile.stationShifts.addExpenseBtn")}</button>
        </div>
      </div>}

      <div className="m-card">
        {confirmClose && <p className="m-error">{t("mobile.stationShifts.closeConfirm")}</p>}
        <button className="m-big-btn" disabled={busy} onClick={doSubmitShift}>
          {t(automated ? (confirmClose ? "mobile.stationShifts.closeShiftConfirmBtn" : "mobile.stationShifts.closeShiftBtn") : "mobile.stationShifts.submitShiftBtn")}
        </button>
      </div>
    </div>
  );
}
