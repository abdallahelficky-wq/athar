import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getDraftEntriesSummary } from "../../api/reports";
import { fmt } from "../../legacy/constants";
import { routes } from "../../routes";

/**
 * سطر "قيود محفوظة" تحت كل شاشة أرصدة: كم في القيود المحفوظة (غير المرحّلة) ضمن نطاق الشاشة نفسه،
 * وهل هي خارج الأرقام المعروضة (الوضع الصحيح: الأرصدة تحتسب المرحَّل فقط) أم داخلها (شركة لم يُفعِّل
 * مالكها المفتاح بعد) — مع رابط لتلك القيود في شاشة القيود. يُبقي قصد "حفظتُ القيد فلماذا لا يظهر في
 * رصيدي؟" واضحاً دون أن تدخل المسودات الأرقام.
 */
// printable: يُطبع مع التقرير (التقرير الشهري الشامل تقرير إدارة يُطبع ويُوزَّع)؛ وإلا يُخفى في الطباعة
// (كشف الحساب المطبوع يُرسَل للعميل/المورد، والسطر معلومة داخلية).
export default function DraftEntriesNotice({ companyId, branchId, accountId, dateFrom, dateTo, printable = false, label }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    getDraftEntriesSummary({ companyId, branchId, accountId, from: dateFrom, to: dateTo })
      .then((d) => { if (live) setData(d); })
      .catch(() => {});
    return () => { live = false; };
  }, [companyId, branchId, accountId, dateFrom, dateTo]);

  if (!data || (data.uncounted.entryCount === 0 && data.counted.entryCount === 0)) return null;
  const link = routes.draftEntries({ accountId, dateFrom, dateTo });
  return (
    <div className={"draft-entries-notice" + (printable ? " draft-entries-print" : "")} data-testid="draft-entries-notice">
      {label && <p className="strong">{label}</p>}
      {data.uncounted.entryCount > 0 && (
        <p>
          {t("draftEntries.uncounted", { count: data.uncounted.entryCount, debit: fmt(data.uncounted.debit), credit: fmt(data.uncounted.credit) })}{" "}
          <Link to={link}>{t("draftEntries.view")}</Link>
        </p>
      )}
      {data.counted.entryCount > 0 && (
        <p className="draft-entries-counted">
          {t("draftEntries.counted", { count: data.counted.entryCount, debit: fmt(data.counted.debit), credit: fmt(data.counted.credit) })}{" "}
          <Link to={link}>{t("draftEntries.view")}</Link>
        </p>
      )}
    </div>
  );
}
