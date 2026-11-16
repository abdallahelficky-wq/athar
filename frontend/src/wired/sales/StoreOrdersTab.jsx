import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listStoreOrders, updateStoreOrderStatus } from "../../api/storeOrders";
import { fmt2 } from "../../legacy/constants";
import { formatDate } from "../../i18n/dateFormat";

const STATUSES = ["new", "confirmed", "completed", "cancelled"];

/**
 * طلبات المتجر الإلكتروني العام لهذه الشركة — قراءة ومتابعة حالة فقط. الطلب يأتي من المتجر (/store/<الرابط>) ولا
 * يُنشئ فاتورة ولا قيداً ولا يحجز مخزوناً: بعد تأكيده مع العميل تُصدَر فاتورة المبيعات من تبويب الفواتير كالمعتاد.
 */
export default function StoreOrdersTab({ companyId }) {
  const { t, i18n } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    listStoreOrders(companyId, status).then(setOrders).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId, status]);

  const changeStatus = async (order, next) => {
    try {
      const updated = await updateStoreOrderStatus(order.id, next);
      setOrders((rows) => rows.map((o) => (o.id === updated.id ? updated : o)));
    } catch (e) { setError(e.message); }
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <section className="panel">
      <p className="note">{t("sales.storeOrders.note")}</p>
      <div className="form-grid">
        <label>{t("sales.storeOrders.status")}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("sales.storeOrders.allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`sales.storeOrders.statuses.${s}`)}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="balance-bad">{error}</p>}
      {loading ? <p className="empty">{t("sales.storeOrders.loading")}</p> : (
        <table className="ledger-table responsive-table">
          <thead>
            <tr>
              <th>{t("sales.storeOrders.number")}</th>
              <th>{t("sales.storeOrders.date")}</th>
              <th>{t("sales.storeOrders.customer")}</th>
              <th>{t("sales.storeOrders.phone")}</th>
              <th>{t("sales.storeOrders.city")}</th>
              <th>{t("sales.storeOrders.total")}</th>
              <th>{t("sales.storeOrders.status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <React.Fragment key={o.id}>
                <tr>
                  <td data-label={t("sales.storeOrders.number")}><strong>{o.number}</strong></td>
                  <td data-label={t("sales.storeOrders.date")}>{formatDate(o.createdAt, i18n.language)}</td>
                  <td data-label={t("sales.storeOrders.customer")}>{o.customerName}</td>
                  <td data-label={t("sales.storeOrders.phone")}><a href={`https://wa.me/${o.phone}`} target="_blank" rel="noreferrer" dir="ltr">{o.phone}</a></td>
                  <td data-label={t("sales.storeOrders.city")}>{o.city}</td>
                  <td data-label={t("sales.storeOrders.total")} className="num">{fmt2(o.total)}</td>
                  <td data-label={t("sales.storeOrders.status")}>
                    <select value={o.status} onChange={(e) => changeStatus(o, e.target.value)} aria-label={t("sales.storeOrders.status")}>
                      {STATUSES.map((s) => <option key={s} value={s}>{t(`sales.storeOrders.statuses.${s}`)}</option>)}
                    </select>
                  </td>
                  <td><button type="button" className="btn-ghost" onClick={() => setOpenId(openId === o.id ? null : o.id)}>{t(openId === o.id ? "sales.storeOrders.hideLines" : "sales.storeOrders.showLines")}</button></td>
                </tr>
                {openId === o.id && (
                  <tr>
                    <td colSpan={8}>
                      {o.notes && <p className="note">{t("sales.storeOrders.notes")}: {o.notes}</p>}
                      <table className="ledger-table">
                        <thead><tr><th>{t("sales.storeOrders.itemCode")}</th><th>{t("sales.storeOrders.item")}</th><th>{t("sales.storeOrders.quantity")}</th><th>{t("sales.storeOrders.unitPrice")}</th><th>{t("sales.storeOrders.lineTotal")}</th></tr></thead>
                        <tbody>
                          {o.lines.map((l) => <tr key={l.id}><td dir="ltr">{l.code}</td><td>{i18n.language === "en" && l.nameEn ? l.nameEn : l.name}</td><td className="num">{l.quantity}</td><td className="num">{fmt2(l.unitPrice)}</td><td className="num">{fmt2(l.lineTotal)}</td></tr>)}
                        </tbody>
                        <tfoot>
                          <tr><td colSpan={4}>{t("sales.storeOrders.subtotal")}</td><td className="num">{fmt2(o.subtotal)}</td></tr>
                          <tr><td colSpan={4}>{t("sales.storeOrders.vat")}</td><td className="num">{fmt2(o.vat)}</td></tr>
                          <tr><td colSpan={4}><strong>{t("sales.storeOrders.total")}</strong></td><td className="num"><strong>{fmt2(o.total)}</strong></td></tr>
                        </tfoot>
                      </table>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {orders.length === 0 && <tr><td className="empty" colSpan={8}>{t("sales.storeOrders.empty")}</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}
