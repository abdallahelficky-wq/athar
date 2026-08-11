import React, { useEffect, useState } from "react";
import { getReportSchedule, updateReportSchedule, sendReportScheduleNow } from "../api/reports";

const FREQUENCY_LABELS = { daily: "يومياً", weekly: "أسبوعياً", monthly: "شهرياً" };
const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// توقيت السعودية (AST) ثابت UTC+3 طوال العام بلا أي توقيت صيفي — تحويل بسيط وآمن دون الحاجة
// لمكتبة مناطق زمنية. الخادم يخزّن الساعة بتوقيت UTC دائماً (hourUtc)؛ هذان التابعان فقط
// يحوّلان للعرض/الإدخال بتوقيت السعودية حتى لا يُضطر المستخدم لحساب الفرق يدوياً.
const KSA_UTC_OFFSET_HOURS = 3;
const utcHourToKsa = (hourUtc) => (Number(hourUtc) + KSA_UTC_OFFSET_HOURS + 24) % 24;
const ksaHourToUtc = (hourKsa) => (Number(hourKsa) - KSA_UTC_OFFSET_HOURS + 24) % 24;

/** لوحة إعداد الإرسال الدوري التلقائي للتقارير المالية بالبريد الإلكتروني — سجل واحد فقط لكل
 * شركة (نفس نمط "حدود التنبيه" في ComprehensiveMonthlyReport.jsx)، مع زر "إرسال الآن" لاختبار
 * الإعدادات فوراً دون انتظار الموعد المجدول. المستخدم يُدخل الساعة بتوقيت السعودية المحلي فقط —
 * التحويل من/إلى UTC (المُخزَّن فعلياً في hourUtc بالخادم) يحدث تلقائياً هنا. */
export default function ReportScheduleAutomation({ companyId }) {
  const [schedule, setSchedule] = useState(null);
  const [recipientsText, setRecipientsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) return;
    setError("");
    setMessage("");
    setSchedule(null);
    getReportSchedule(companyId)
      .then((data) => {
        setSchedule(data);
        setRecipientsText((data.recipientEmails || []).join(", "));
      })
      .catch((e) => setError(e.message));
  }, [companyId]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة لضبط إرسال تقاريرها.</p>;
  if (error && !schedule) return <p className="balance-bad">{error}</p>;
  if (!schedule) return <p className="empty">جارٍ التحميل...</p>;

  const setField = (field, value) => setSchedule((s) => ({ ...s, [field]: value }));

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const recipientEmails = recipientsText.split(",").map((s) => s.trim()).filter(Boolean);
      const saved = await updateReportSchedule(companyId, {
        frequency: schedule.frequency,
        dayOfWeek: Number(schedule.dayOfWeek),
        dayOfMonth: Number(schedule.dayOfMonth),
        hourUtc: Number(schedule.hourUtc),
        includeComprehensiveMonthly: schedule.includeComprehensiveMonthly,
        includeTrialBalance: schedule.includeTrialBalance,
        includeIncomeStatement: schedule.includeIncomeStatement,
        includeBalanceSheet: schedule.includeBalanceSheet,
        recipientEmails,
        enabled: schedule.enabled,
      });
      setSchedule(saved);
      setRecipientsText((saved.recipientEmails || []).join(", "));
      setMessage("تم حفظ إعدادات الإرسال الدوري بنجاح.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async () => {
    setSending(true);
    setError("");
    setMessage("");
    try {
      const res = await sendReportScheduleNow(companyId);
      setMessage(`تم إرسال التقرير الآن إلى: ${res.sentTo.join("، ")}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="panel">
      <h3>أتمتة إرسال التقارير المالية بالبريد الإلكتروني</h3>
      <p className="empty">
        يُرسَل ملخّص التقارير المختارة أدناه تلقائياً بالبريد الإلكتروني حسب الجدولة المحددة —
        لكل مستخدمي هذه الشركة بدور مدير/مدير حسابات افتراضياً، أو لقائمة بريدية مخصّصة إن أضفتها أدناه.
      </p>

      <div className="filter-bar">
        <label>
          دورية الإرسال
          <select value={schedule.frequency} onChange={(e) => setField("frequency", e.target.value)}>
            {Object.entries(FREQUENCY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>
        {schedule.frequency === "weekly" && (
          <label>
            يوم الأسبوع
            <select value={schedule.dayOfWeek} onChange={(e) => setField("dayOfWeek", e.target.value)}>
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </label>
        )}
        {schedule.frequency === "monthly" && (
          <label>
            يوم الشهر
            <input type="number" min={1} max={28} value={schedule.dayOfMonth} onChange={(e) => setField("dayOfMonth", e.target.value)} />
          </label>
        )}
        <label>
          ساعة الإرسال (بتوقيت السعودية)
          <input
            type="number"
            min={0}
            max={23}
            value={utcHourToKsa(schedule.hourUtc)}
            onChange={(e) => setField("hourUtc", ksaHourToUtc(e.target.value))}
          />
        </label>
        <label className="checkbox-label" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={schedule.enabled} onChange={(e) => setField("enabled", e.target.checked)} /> تفعيل الإرسال التلقائي
        </label>
      </div>
      <p className="empty" style={{ marginTop: -8 }}>
        مثال: 6 تعني الساعة 6:00 صباحاً بتوقيت السعودية — التحويل من/إلى UTC يحدث تلقائياً، لا حاجة لحساب الفرق يدوياً.
      </p>

      <div className="filter-bar">
        <label className="checkbox-label">
          <input type="checkbox" checked={schedule.includeComprehensiveMonthly} onChange={(e) => setField("includeComprehensiveMonthly", e.target.checked)} /> الملخص الشهري الشامل
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={schedule.includeTrialBalance} onChange={(e) => setField("includeTrialBalance", e.target.checked)} /> ميزان المراجعة
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={schedule.includeIncomeStatement} onChange={(e) => setField("includeIncomeStatement", e.target.checked)} /> قائمة الدخل
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={schedule.includeBalanceSheet} onChange={(e) => setField("includeBalanceSheet", e.target.checked)} /> المركز المالي
        </label>
      </div>

      <label style={{ display: "block", marginTop: 12 }}>
        مستلمون إضافيون (اختياري — بريد إلكتروني مفصول بفاصلة، اتركه فارغاً لإرسال تلقائي لكل مديري/مديري حسابات هذه الشركة)
        <input
          type="text"
          style={{ width: "100%" }}
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
          placeholder="finance@example.com, ceo@example.com"
        />
      </label>

      <div className="filter-bar" style={{ marginTop: 16 }}>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الإعدادات"}</button>
        <button className="btn-secondary" onClick={sendNow} disabled={sending}>{sending ? "جارٍ الإرسال..." : "إرسال الآن (اختبار)"}</button>
      </div>

      {schedule.lastSentAt && <p className="empty">آخر إرسال فعلي: {new Date(schedule.lastSentAt).toLocaleString("ar-EG")}</p>}
      {message && <p className="balance-ok">{message}</p>}
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}
