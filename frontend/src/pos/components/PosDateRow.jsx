import React from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../i18n/dateFormat";

function toDateInputValue(date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function isSameCalendarDay(a, b) {
  return toDateInputValue(a) === toDateInputValue(b);
}

/**
 * صف تاريخين مضغوط أعلى شاشة البيع (لا شاشة الدفع، حتى لا يزاحم أزرار الدفع إطلاقاً): تاريخ
 * الإصدار للعرض فقط (بلا أي عنصر تفاعلي — لا يجوز تعديله مهما كانت الحال، هذا هو التاريخ الفعلي
 * الذي سيُسجَّل على الفاتورة والقيد المحاسبي دائماً)، وتاريخ التوريد قابل للتعديل لتسجيل زيارة
 * ميدانية سابقة لم تُفوَتَر يوم حدوثها. تغييره لتاريخ غير اليوم يعرض تأكيداً عربياً صريحاً قبل
 * تطبيقه فعلياً — إجراء متعمَّد لا حادث نقرة.
 */
export default function PosDateRow({ supplyDate, onSupplyDateChange }) {
  const { t, i18n } = useTranslation();
  const today = new Date();
  const dateOpts = { weekday: "long", day: "numeric", month: "short" };

  const handleChange = (e) => {
    const raw = e.target.value;
    if (!raw) return;
    const chosen = new Date(`${raw}T00:00:00`);
    if (isSameCalendarDay(chosen, today)) {
      onSupplyDateChange(chosen);
      return;
    }
    const formatted = formatDate(chosen, i18n.language, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (window.confirm(t("pos.sale.confirmSupplyDateChange", { date: formatted }))) {
      onSupplyDateChange(chosen);
    }
  };

  return (
    <div className="pos-date-row">
      <div className="pos-date-item">
        <span className="pos-date-label">{t("pos.sale.issueDateLabel")}</span>
        <span className="pos-date-value">{formatDate(today, i18n.language, dateOpts)}</span>
      </div>
      <div className="pos-date-item pos-date-item-editable">
        <span className="pos-date-label">{t("pos.sale.supplyDateLabel")}</span>
        <input
          type="date"
          className="pos-supply-date-input"
          value={toDateInputValue(supplyDate)}
          max={toDateInputValue(today)}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
