import React, { useEffect, useState } from "react";
import { getSalesByCustomer, getSalesMonthly, getSalesVatSummary, getReceivablesAging } from "../../api/salesReports";
import { fmt } from "../../legacy/constants";

const TABS = [
  { id: "byCustomer", label: "حسب العميل" },
  { id: "monthly", label: "الاتجاه الشهري" },
  { id: "aging", label: "أعمار الذمم" },
  { id: "vat", label: "ملخص الضريبة" },
];

export default function SalesReportsTab({ companyId }) {
  const [tab, setTab] = useState("byCustomer");
  const [byCustomer, setByCustomer] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [aging, setAging] = useState([]);
  const [vat, setVat] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    getSalesByCustomer(companyId).then(setByCustomer);
    getSalesMonthly(companyId).then(setMonthly);
    getReceivablesAging(companyId).then(setAging);
    getSalesVatSummary(companyId).then(setVat);
  }, [companyId]);

  if (!companyId) return <p className="empty">أنشئ شركة أولاً من لوحة القيادة.</p>;

  return (
    <div>
      <div className="report-tabs">
        {TABS.map((t) => <button key={t.id} className={"report-tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === "byCustomer" && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>العميل</th><th>عدد الفواتير</th><th>إجمالي المبيعات</th><th>إجمالي المردودات</th><th>صافي المبيعات</th><th>الرصيد المستحق</th></tr></thead>
            <tbody>
              {byCustomer.map((r) => (
                <tr key={r.customerId}>
                  <td>{r.customerName}</td><td className="num">{r.invoiceCount}</td>
                  <td className="num">{fmt(r.totalInvoices)}</td><td className="num">{fmt(r.totalReturns)}</td>
                  <td className="num strong">{fmt(r.netSales)}</td><td className="num">{fmt(r.outstanding)}</td>
                </tr>
              ))}
              {byCustomer.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد بيانات بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "monthly" && (
        <div className="panel">
          <table className="ledger-table">
            <thead><tr><th>الشهر</th><th>إجمالي المبيعات</th></tr></thead>
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
            <thead><tr><th>العميل</th><th>0-30 يوم</th><th>31-60 يوم</th><th>61-90 يوم</th><th>أكثر من 90 يوم</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {aging.map((r) => (
                <tr key={r.customerId}>
                  <td>{r.customerName}</td><td className="num">{fmt(r.current)}</td><td className="num">{fmt(r.d30)}</td>
                  <td className="num">{fmt(r.d60)}</td><td className="num">{fmt(r.d90)}</td><td className="num strong">{fmt(r.total)}</td>
                </tr>
              ))}
              {aging.length === 0 && <tr><td className="empty" colSpan={6}>لا توجد ذمم مستحقة.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "vat" && vat && (
        <div className="panel">
          <table className="ledger-table">
            <tbody>
              <tr><td>إجمالي المبيعات قبل الضريبة</td><td className="num">{fmt(vat.salesBase)}</td></tr>
              <tr><td>ضريبة المخرجات</td><td className="num">{fmt(vat.outputVat)}</td></tr>
              <tr><td>إجمالي المردودات قبل الضريبة</td><td className="num">{fmt(vat.returnsBase)}</td></tr>
              <tr><td>ضريبة المردودات</td><td className="num">{fmt(vat.returnsVat)}</td></tr>
              <tr className="net-row"><td className="strong">صافي ضريبة المخرجات المستحقة</td><td className="num strong">{fmt(vat.netOutputVat)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
