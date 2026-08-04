import React from "react";
import { PrintShell } from "../legacy/shared";
import { fmt } from "../legacy/constants";

/**
 * نسخة قابلة للطباعة من ميزان المراجعة الهرمي — تعرض بالضبط نفس الصفوف الظاهرة حالياً على الشاشة
 * (visibleRows مبنية من نفس expandedIds/hideZeroActivity/search المستخدَمة في الشاشة، انظر
 * ReportsModule) بنفس الترتيب والتداخل (indentation)، داخل PrintShell المشترك (شعار/بيانات
 * الشركة + اسم المستخدم وتاريخ الطباعة). الجدول عنصر <table> عادي بـ <thead> حقيقي فيتكرر رأس
 * الأعمدة تلقائياً في كل صفحة عبر آلية الطباعة الأصلية للمتصفح دون أي كود إضافي.
 */
export default function TrialBalanceTreePrintModal({ visibleRows, totals, balanced, dateFrom, dateTo, company, onClose }) {
  const periodLabel = dateFrom || dateTo
    ? `الفترة: من ${dateFrom || "بداية النشاط"} إلى ${dateTo || "اليوم"}`
    : "الفترة: منذ بداية النشاط حتى اليوم";

  return (
    <PrintShell
      subtitle="ميزان المراجعة"
      company={company}
      showSignatures={false}
      refNode={<div>{periodLabel}</div>}
      onClose={onClose}
    >
      <table className="ledger-table voucher-table tb-print-table">
        <thead>
          <tr>
            <th rowSpan={2}>الحساب</th>
            <th colSpan={2}>الرصيد الافتتاحي</th>
            <th colSpan={2}>حركة الفترة</th>
            <th colSpan={2}>الرصيد الختامي</th>
          </tr>
          <tr>
            <th>مدين</th><th>دائن</th>
            <th>مدين</th><th>دائن</th>
            <th>مدين</th><th>دائن</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(({ node, depth }) => (
            <tr key={node.accountId} className={!node.isPosting ? "strong" : ""}>
              <td style={{ paddingRight: 8 + depth * 18 }}>{node.code} — {node.name}</td>
              <td className="num">{node.opening.debit ? fmt(node.opening.debit) : "—"}</td>
              <td className="num">{node.opening.credit ? fmt(node.opening.credit) : "—"}</td>
              <td className="num">{node.period.debit ? fmt(node.period.debit) : "—"}</td>
              <td className="num">{node.period.credit ? fmt(node.period.credit) : "—"}</td>
              <td className="num">{node.closing.debit ? fmt(node.closing.debit) : "—"}</td>
              <td className="num">{node.closing.credit ? fmt(node.closing.credit) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="foot-label">الإجمالي العام</td>
            <td className="num strong">{fmt(totals.openingDebit)}</td>
            <td className="num strong">{fmt(totals.openingCredit)}</td>
            <td className="num strong">{fmt(totals.periodDebit)}</td>
            <td className="num strong">{fmt(totals.periodCredit)}</td>
            <td className="num strong">{fmt(totals.closingDebit)}</td>
            <td className="num strong">{fmt(totals.closingCredit)} {balanced ? "✓" : "⚠"}</td>
          </tr>
        </tfoot>
      </table>
    </PrintShell>
  );
}
