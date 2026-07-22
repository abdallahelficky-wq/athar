import React, { useEffect, useState } from "react";
import { getPurchasesBySupplier, getPurchasesMonthly, getPurchasesVatSummary, getPayablesAging } from "../../api/purchaseReports";
import { fmt } from "../../legacy/constants";

const TABS = [
  { id: "bySupplier", label: "حسب المورد" },
  { id: "monthly", label: "الاتجاه الشهري" },
  { id: "aging", label: "أعمار الذمم" },
  { id: "vat", label: "ملخص الضريبة" },
];

export default function PurchaseReportsTab({ companyId }) {
  const [tab, setTab] = useState("bySupplier");
  const [bySupplier, setBySupplier] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [aging, setAging] = useState([]);
  const [vat, setVat] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    getPurchasesBySupplier(companyId).then(setBySupplier);
    getPurchasesMonthly(companyId).then(setMonthly);
    getPayablesAging(companyId).then(setAging);
    getPurchasesVatSummary(companyId).then(setVat);
  }, [companyId]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="report-tabs">
        {TABS.map((t) => <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === "bySupplier" && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>المورد</th><th>عدد الفواتير</th><th>إجمالي المشتريات</th><th>إجمالي المردودات</th><th>صافي المشتريات</th></tr></thead>
            <tbody>
              {bySupplier.map((r) => (
                <tr key={r.supplierId}>
                  <td>{r.supplierName}</td><td className="num">{r.invoiceCount}</td>
                  <td className="num">{fmt(r.totalInvoices)}</td><td className="num">{fmt(r.totalReturns)}</td>
                  <td className="num strong">{fmt(r.netPurchases)}</td>
                </tr>
              ))}
              {bySupplier.length === 0 && <tr><td className="empty" colSpan={5}>لا توجد بيانات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "monthly" && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الشهر</th><th>إجمالي المشتريات</th></tr></thead>
            <tbody>
              {monthly.map((r) => <tr key={r.month}><td>{r.month}</td><td className="num">{fmt(r.total)}</td></tr>)}
              {monthly.length === 0 && <tr><td className="empty" colSpan={2}>لا توجد بيانات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "aging" && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>المورد</th><th>0-30 يوم</th><th>31-60 يوم</th><th>61-90 يوم</th><th>أكثر من 90 يوم</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {aging.map((r) => (
                <tr key={r.supplierId}>
                  <td>{r.supplierName}</td><td className="num">{fmt(r.current)}</td><td className="num">{fmt(r.d30)}</td>
                  <td className="num">{fmt(r.d60)}</td><td className="num">{fmt(r.d90)}</td><td className="num strong">{fmt(r.total)}</td>
                </tr>
              ))}
              {aging.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد ذمم مستحقة.</td></tr>}
            </tbody>
          </table>
          <p className="note">ملاحظة: لا يوجد بعد موديول "سند صرف" لتسجيل سداد فواتير الموردين، لذا تُعتبر كل فاتورة مرحّلة مستحقة بالكامل.</p>
        </div>
      )}

      {tab === "vat" && vat && (
        <div className="panel">
          <table className="ledger-table">
            <tbody>
              <tr><td>إجمالي المشتريات قبل الضريبة</td><td className="num">{fmt(vat.purchasesBase)}</td></tr>
              <tr><td>ضريبة المدخلات</td><td className="num">{fmt(vat.inputVat)}</td></tr>
              <tr><td>إجمالي المردودات قبل الضريبة</td><td className="num">{fmt(vat.returnsBase)}</td></tr>
              <tr><td>ضريبة المردودات</td><td className="num">{fmt(vat.returnsVat)}</td></tr>
              <tr className="net-row"><td className="strong">صافي ضريبة المدخلات القابلة للخصم</td><td className="num strong">{fmt(vat.netInputVat)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
