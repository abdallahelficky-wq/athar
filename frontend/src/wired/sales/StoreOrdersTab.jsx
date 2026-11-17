import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listStoreOrders, updateStoreOrderStatus, createStoreOrderInvoice } from "../../api/storeOrders";
import { listAccounts } from "../../api/accounts";
import AccountSearchSelect from "../shared/AccountSearchSelect";
import { fmt2 } from "../../legacy/constants";
import { formatDate } from "../../i18n/dateFormat";

const STATUSES = ["new", "confirmed", "completed", "cancelled"];
const K = "sales.storeOrders";
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shippingKey = (companyId) => `athar.storeShippingAccount.${companyId}`;

/** نص رسالة واتساب للعميل عن طلبه — يُفتَح في واتساب جاهزاً للتعديل قبل الإرسال (لا يُرسَل شيء تلقائياً). */
function whatsappText(t, o, kind) {
  const lines = o.lines.map((l) => `• ${l.name} × ${l.quantity} = ${fmt2(l.lineTotal)}`);
  const head = t(`${K}.wa.${kind}`, { name: o.customerName, number: o.number });
  if (kind === "shipped") return head;
  return [
    head, "", ...lines,
    ...(Number(o.discountAmount) > 0 ? [`${t(`${K}.discount`)}: −${fmt2(o.discountAmount)}`] : []),
    ...(Number(o.shippingFee) > 0 ? [`${t(`${K}.shippingFee`)}: ${fmt2(o.shippingFee)}`] : []),
    `${t(`${K}.total`)}: ${fmt2(o.total)} ${o.currency}`,
    `${t(`${K}.payment`)}: ${t(`${K}.paymentMethods.${["cod", "bank_transfer"].includes(o.paymentMethod) ? o.paymentMethod : "unspecified"}`)}`,
    ...(o.salesInvoice ? [`${t(`${K}.invoice`)}: ${o.salesInvoice.invoiceNumber}`] : []),
  ].join("\n");
}
const whatsappUrl = (t, o, kind) => `https://wa.me/${o.phone}?text=${encodeURIComponent(whatsappText(t, o, kind))}`;

/** ورقة تجهيز الطلب للطباعة (للمستودع/المندوب) — نافذة مستقلة بلا واجهة النظام. */
function printOrder(t, o, dir) {
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) return;
  const row = (l) => `<tr><td dir="ltr">${escapeHtml(l.code)}</td><td>${escapeHtml(l.name)}</td><td>${l.quantity}</td><td>${fmt2(l.unitPrice)}</td><td>${fmt2(l.lineTotal)}</td></tr>`;
  const foot = (label, value) => `<tr><td colspan="4">${escapeHtml(label)}</td><td>${value}</td></tr>`;
  w.document.write(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${escapeHtml(t(`${K}.printTitle`, { number: o.number }))}</title>
<style>body{font-family:Arial,Tahoma,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 12px}p{margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #999;padding:6px 8px;text-align:start;font-size:13px}th{background:#eee}tfoot td{font-weight:bold}</style></head><body>
<h1>${escapeHtml(t(`${K}.printTitle`, { number: o.number }))}</h1>
<p>${escapeHtml(t(`${K}.date`))}: ${escapeHtml(new Date(o.createdAt).toLocaleDateString("en-GB"))}</p>
<p>${escapeHtml(t(`${K}.customer`))}: ${escapeHtml(o.customerName)} — <span dir="ltr">${escapeHtml(o.phone)}</span></p>
<p>${escapeHtml(t(`${K}.shipping`))}: ${escapeHtml(t(`${K}.shippingMethods.${o.shippingMethod === "pickup" ? "pickup" : "delivery"}`))}${o.shippingMethod === "pickup" ? "" : ` — ${escapeHtml(o.city)}`}</p>
<p>${escapeHtml(t(`${K}.payment`))}: ${escapeHtml(t(`${K}.paymentMethods.${["cod", "bank_transfer"].includes(o.paymentMethod) ? o.paymentMethod : "unspecified"}`))}</p>
${o.notes ? `<p>${escapeHtml(t(`${K}.notes`))}: ${escapeHtml(o.notes)}</p>` : ""}
<table><thead><tr><th>${escapeHtml(t(`${K}.itemCode`))}</th><th>${escapeHtml(t(`${K}.item`))}</th><th>${escapeHtml(t(`${K}.quantity`))}</th><th>${escapeHtml(t(`${K}.unitPrice`))}</th><th>${escapeHtml(t(`${K}.lineTotal`))}</th></tr></thead>
<tbody>${o.lines.map(row).join("")}</tbody><tfoot>
${Number(o.discountAmount) > 0 ? foot(t(`${K}.discount`), `−${fmt2(o.discountAmount)}`) : ""}${Number(o.shippingFee) > 0 ? foot(t(`${K}.shippingFee`), fmt2(o.shippingFee)) : ""}${foot(t(`${K}.total`), `${fmt2(o.total)} ${escapeHtml(o.currency)}`)}
</tfoot></table></body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

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
  const [revenueAccounts, setRevenueAccounts] = useState([]);
  const [shippingAccountId, setShippingAccountId] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  // حساب إيراد الشحن: حسابات الإيراد التفصيلية للشركة، وآخر اختيار يُحفَظ في المتصفح فلا يُسأل عنه كل مرة
  useEffect(() => {
    if (!companyId) return;
    let saved = "";
    try { saved = localStorage.getItem(shippingKey(companyId)) || ""; } catch { /* تخزين غير متاح */ }
    listAccounts({ companyId, includePartyAccounts: false })
      .then((rows) => {
        const revenue = rows.filter((a) => a.type === "revenue" && a.isPosting);
        setRevenueAccounts(revenue);
        setShippingAccountId(revenue.some((a) => a.id === saved) ? saved : "");
      })
      .catch(() => setRevenueAccounts([]));
  }, [companyId]);

  const pickShippingAccount = (id) => {
    setShippingAccountId(id || "");
    try { if (id) localStorage.setItem(shippingKey(companyId), id); } catch { /* تخزين غير متاح */ }
  };

  const issueInvoice = async (order) => {
    setBusyId(order.id); setError(""); setNotice(null);
    try {
      const result = await createStoreOrderInvoice(order.id, Number(order.shippingFee) > 0 ? shippingAccountId : null);
      setOrders((rows) => rows.map((o) => (o.id === result.order.id ? result.order : o)));
      setNotice(result);
    } catch (e) { setError(e.message); } finally { setBusyId(null); }
  };

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
      {notice && (
        <p className={notice.difference ? "balance-bad" : "balance-ok"}>
          {t(`${K}.invoiceCreated`, { number: notice.invoiceNumber })}{" "}
          {notice.customerCreated && t(`${K}.customerCreated`)}{" "}
          {notice.difference ? t(`${K}.invoiceDifference`, { invoice: fmt2(notice.invoiceTotal), order: fmt2(notice.orderTotal) }) : ""}{" "}
          <a href="/sales/invoices">{t(`${K}.openInvoices`)}</a>
        </p>
      )}
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
              <th>{t(`${K}.invoice`)}</th>
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
                  <td data-label={t(`${K}.invoice`)}>
                    {o.salesInvoice
                      ? <a href="/sales/invoices" dir="ltr" title={t(`${K}.openInvoices`)}>{o.salesInvoice.invoiceNumber}</a>
                      : "—"}
                    {o.salesInvoice && <span className={"status-badge" + (o.salesInvoice.status === "draft" ? " status-neutral" : " status-posted")}> {t(`${K}.invoiceStatuses.${o.salesInvoice.status === "draft" ? "draft" : "posted"}`)}</span>}
                  </td>
                  <td><button type="button" className="btn-ghost" onClick={() => setOpenId(openId === o.id ? null : o.id)}>{t(openId === o.id ? "sales.storeOrders.hideLines" : "sales.storeOrders.showLines")}</button></td>
                </tr>
                {openId === o.id && (
                  <tr>
                    <td colSpan={9}>
                      <div className="row-actions store-order-actions">
                        {!o.salesInvoice && o.status !== "cancelled" && (
                          <>
                            {Number(o.shippingFee) > 0 && (
                              <label className="store-order-account">{t(`${K}.shippingAccount`)}
                                <AccountSearchSelect accounts={revenueAccounts} value={shippingAccountId} onChange={pickShippingAccount} />
                              </label>
                            )}
                            <button type="button" className="btn-primary" disabled={busyId === o.id || (Number(o.shippingFee) > 0 && !shippingAccountId)} onClick={() => issueInvoice(o)}>
                              {busyId === o.id ? t(`${K}.issuing`) : t(`${K}.issueInvoice`)}
                            </button>
                          </>
                        )}
                        <a className="btn-ghost" href={whatsappUrl(t, o, "confirm")} target="_blank" rel="noreferrer">{t(`${K}.waConfirm`)}</a>
                        <a className="btn-ghost" href={whatsappUrl(t, o, "shipped")} target="_blank" rel="noreferrer">{t(`${K}.waShipped`)}</a>
                        <button type="button" className="btn-ghost" onClick={() => printOrder(t, o, i18n.dir())}>{t(`${K}.print`)}</button>
                      </div>
                      {!o.salesInvoice && o.status !== "cancelled" && <p className="note">{t(`${K}.issueInvoiceNote`)}</p>}
                      <p className="note">
                        {t("sales.storeOrders.shipping")}: {t(`sales.storeOrders.shippingMethods.${o.shippingMethod === "pickup" ? "pickup" : "delivery"}`)}
                        {" · "}{t("sales.storeOrders.payment")}: {t(`sales.storeOrders.paymentMethods.${["cod", "bank_transfer"].includes(o.paymentMethod) ? o.paymentMethod : "unspecified"}`)}
                      </p>
                      {o.notes && <p className="note">{t("sales.storeOrders.notes")}: {o.notes}</p>}
                      <table className="ledger-table">
                        <thead><tr><th>{t("sales.storeOrders.itemCode")}</th><th>{t("sales.storeOrders.item")}</th><th>{t("sales.storeOrders.quantity")}</th><th>{t("sales.storeOrders.unitPrice")}</th><th>{t("sales.storeOrders.lineTotal")}</th></tr></thead>
                        <tbody>
                          {o.lines.map((l) => <tr key={l.id}><td dir="ltr">{l.code}</td><td>{i18n.language === "en" && l.nameEn ? l.nameEn : l.name}</td><td className="num">{l.quantity}</td><td className="num">{fmt2(l.unitPrice)}</td><td className="num">{fmt2(l.lineTotal)}</td></tr>)}
                        </tbody>
                        <tfoot>
                          {Number(o.discountAmount) > 0 && <tr><td colSpan={4}>{t("sales.storeOrders.discount")}{o.couponCode ? ` (${o.couponCode})` : ""}</td><td className="num">−{fmt2(o.discountAmount)}</td></tr>}
                          {Number(o.shippingFee) > 0 && <tr><td colSpan={4}>{t("sales.storeOrders.shippingFee")}</td><td className="num">{fmt2(o.shippingFee)}</td></tr>}
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
            {orders.length === 0 && <tr><td className="empty" colSpan={9}>{t("sales.storeOrders.empty")}</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}
