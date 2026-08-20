import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getReportSchedule, updateReportSchedule, sendReportScheduleNow } from "../api/reports";
import { formatDateTime } from "../i18n/dateFormat";

/** لوحة إعداد الإرسال الدوري التلقائي للتقارير المالية بالبريد الإلكتروني — سجل واحد فقط لكل
 * شركة (نفس نمط "حدود التنبيه" في ComprehensiveMonthlyReport.jsx)، مع زر "إرسال الآن" لاختبار
 * الإعدادات فوراً دون انتظار الموعد المجدول. كل حقول الوقت هنا (يوم الأسبوع/يوم الشهر/الساعة)
 * تُدخَل وتُخزَّن وتُقارَن بتوقيت السعودية مباشرة (لا تحويل UTC هنا ولا في الخادم) — تفادياً لخطأ
 * انزياح يوم كامل كان يحدث سابقاً عند تحويل الساعة فقط دون اليوم المرافق لها قرب منتصف الليل. */
export default function ReportScheduleAutomation({ companyId }) {
  const { t, i18n } = useTranslation();
  const FREQUENCY_LABELS = { daily: t("reports.automation.frequency.daily"), weekly: t("reports.automation.frequency.weekly"), monthly: t("reports.automation.frequency.monthly") };
  const WEEKDAYS = t("reports.automation.weekdays", { returnObjects: true });

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

  if (!companyId) return <p className="empty">{t("reports.automation.noCompany")}</p>;
  if (error && !schedule) return <p className="balance-bad">{error}</p>;
  if (!schedule) return <p className="empty">{t("common.loading")}</p>;

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
        hourKsa: Number(schedule.hourKsa),
        includeComprehensiveMonthly: schedule.includeComprehensiveMonthly,
        includeTrialBalance: schedule.includeTrialBalance,
        includeIncomeStatement: schedule.includeIncomeStatement,
        includeBalanceSheet: schedule.includeBalanceSheet,
        recipientEmails,
        enabled: schedule.enabled,
      });
      setSchedule(saved);
      setRecipientsText((saved.recipientEmails || []).join(", "));
      setMessage(t("reports.automation.savedMsg"));
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
      setMessage(t("reports.automation.sentMsg", { emails: res.sentTo.join("، ") }));
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="panel">
      <h3>{t("reports.automation.title")}</h3>
      <p className="empty">{t("reports.automation.intro")}</p>

      <div className="filter-bar">
        <label>
          {t("reports.automation.frequencyLabel")}
          <select value={schedule.frequency} onChange={(e) => setField("frequency", e.target.value)}>
            {Object.entries(FREQUENCY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>
        {schedule.frequency === "weekly" && (
          <label>
            {t("reports.automation.dayOfWeekLabel")}
            <select value={schedule.dayOfWeek} onChange={(e) => setField("dayOfWeek", e.target.value)}>
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </label>
        )}
        {schedule.frequency === "monthly" && (
          <label>
            {t("reports.automation.dayOfMonthLabel")}
            <input type="number" min={1} max={28} value={schedule.dayOfMonth} onChange={(e) => setField("dayOfMonth", e.target.value)} />
          </label>
        )}
        <label>
          {t("reports.automation.hourLabel")}
          <input
            type="number"
            min={0}
            max={23}
            value={schedule.hourKsa}
            onChange={(e) => setField("hourKsa", e.target.value)}
          />
        </label>
        <label className="checkbox-label" style={{ alignSelf: "end" }}>
          <input type="checkbox" checked={schedule.enabled} onChange={(e) => setField("enabled", e.target.checked)} /> {t("reports.automation.enableToggle")}
        </label>
      </div>
      <p className="empty" style={{ marginTop: -8 }}>{t("reports.automation.timezoneNote")}</p>

      <div className="filter-bar">
        <label className="checkbox-label">
          <input type="checkbox" checked={schedule.includeComprehensiveMonthly} onChange={(e) => setField("includeComprehensiveMonthly", e.target.checked)} /> {t("reports.automation.includeMonthly")}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={schedule.includeTrialBalance} onChange={(e) => setField("includeTrialBalance", e.target.checked)} /> {t("nav.tabs.trial")}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={schedule.includeIncomeStatement} onChange={(e) => setField("includeIncomeStatement", e.target.checked)} /> {t("nav.tabs.income")}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={schedule.includeBalanceSheet} onChange={(e) => setField("includeBalanceSheet", e.target.checked)} /> {t("nav.tabs.balance")}
        </label>
      </div>

      <label style={{ display: "block", marginTop: 12 }}>
        {t("reports.automation.recipientsLabel")}
        <input
          type="text"
          style={{ width: "100%" }}
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
          placeholder="finance@example.com, ceo@example.com"
        />
      </label>

      <div className="filter-bar" style={{ marginTop: 16 }}>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? t("reports.automation.saving") : t("reports.automation.saveBtn")}</button>
        <button className="btn-secondary" onClick={sendNow} disabled={sending}>{sending ? t("reports.automation.sending") : t("reports.automation.sendNowBtn")}</button>
      </div>

      {schedule.lastSentAt && <p className="empty">{t("reports.automation.lastSent", { date: formatDateTime(schedule.lastSentAt, i18n.language) })}</p>}
      {message && <p className="balance-ok">{message}</p>}
      {error && <p className="balance-bad">{error}</p>}
    </div>
  );
}
