import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listSuppliers } from "../../api/suppliers";
import { listAccounts } from "../../api/accounts";
import { listItems } from "../../api/items";
import { listWarehouses } from "../../api/warehouses";
import {
  listPurchaseInvoices, createPurchaseInvoice, deletePurchaseInvoice, postPurchaseInvoice, unpostPurchaseInvoice,
} from "../../api/purchaseInvoices";
import { fmt } from "../../legacy/constants";
import { Icon } from "../../legacy/shared";
import PurchaseInvoiceLinesEditor, { emptyPurchaseLine } from "./PurchaseInvoiceLinesEditor";
import UnpostModal from "../shared/UnpostModal";
import AttachmentsPanel from "../shared/AttachmentsPanel";
import PurchaseInvoiceViewModal from "./PurchaseInvoiceViewModal";
import { currencyLabel } from "../../shared/countries";

export default function PurchaseInvoicesTab({ companyId, companies }) {
  const { t, i18n } = useTranslation();
  const currency = currencyLabel(companies?.find((c) => c.id === companyId)?.currency, i18n.language);
  const [suppliers, setSuppliers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([emptyPurchaseLine()]);
  const [unpostTarget, setUnpostTarget] = useState(null);
  const [attachmentsFor, setAttachmentsFor] = useState(null);
  const [viewInvoice, setViewInvoice] = useState(null);
  const [autoPrint, setAutoPrint] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    listSuppliers(companyId).then((ss) => { setSuppliers(ss); if (ss[0]) setSupplierId((s) => s || ss[0].id); });
    listAccounts({ companyId }).then(setAccounts);
    listItems(companyId).then(setItems);
    listWarehouses(companyId).then(setWarehouses);
  }, [companyId]);

  const reload = () => {
    if (!companyId) return;
    setLoading(true);
    listPurchaseInvoices(companyId).then(setInvoices).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(reload, [companyId]);

  const cleanLines = () => lines
    .filter((l) => (l.itemId || l.accountId) && Number(l.unitPrice) > 0)
    .map((l) => ({
      // إلزامي في المخطط حتى للأسطر المرتبطة بصنف — الخادم يتجاهله ويشتق الحساب الفعلي من نوع
      // الصنف، فتكفي أي قيمة غير فارغة هنا عندما يكون itemId موجوداً
      accountId: l.accountId || l.itemId,
      itemId: l.itemId || undefined,
      warehouseId: l.warehouseId || undefined,
      usefulLifeYears: l.usefulLifeYears !== "" ? Number(l.usefulLifeYears) : undefined,
      salvageValue: l.salvageValue !== "" ? Number(l.salvageValue) : undefined,
      description: l.description || undefined,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPct: Number(l.discountPct || 0),
      priceIncludesVat: l.priceIncludesVat,
    }));

  const save = async () => {
    if (!supplierId) return;
    try {
      await createPurchaseInvoice({ companyId, supplierId, date, lines: cleanLines() });
      setLines([emptyPurchaseLine()]);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (inv) => {
    if (!window.confirm(t("purchases.invoices.confirmDelete", { number: inv.invoiceNumber }))) return;
    try {
      await deletePurchaseInvoice(inv.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doPost = async (inv) => {
    try {
      await postPurchaseInvoice(inv.id);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const doUnpost = async (pin) => {
    await unpostPurchaseInvoice(unpostTarget.id, pin);
    setUnpostTarget(null);
    reload();
  };

  if (!companyId) return <p className="empty">{t("common.noCompany")}</p>;

  return (
    <div>
      <div className="panel form-panel">
        <div className="form-grid header-grid">
          <label>{t("purchases.invoices.supplier")}<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>{t("purchases.invoices.invoiceDate")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {suppliers.length === 0 && <p className="empty">{t("purchases.invoices.addSupplierFirst")}</p>}

        <PurchaseInvoiceLinesEditor lines={lines} setLines={setLines} accounts={accounts} items={items} warehouses={warehouses} currency={currency} />
        {error && <p className="balance-bad">{error}</p>}
        <div className="form-btn-group">
          <button className="btn-primary" onClick={save} disabled={!supplierId}>{t("purchases.invoices.saveAndPost")}</button>
        </div>
      </div>

      {loading ? <p className="empty">{t("purchases.invoices.loading")}</p> : (
        <div className="panel">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>{t("purchases.invoices.table.number")}</th><th>{t("purchases.invoices.table.supplier")}</th>
                <th>{t("purchases.invoices.table.date")}</th><th>{t("purchases.invoices.table.total")}</th>
                <th>{t("purchases.invoices.table.status")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <React.Fragment key={inv.id}>
                  <tr>
                    <td>{inv.invoiceNumber}</td><td>{inv.supplier?.name}</td><td>{inv.date.slice(0, 10)}</td>
                    <td className="num">{fmt(inv.grandTotal)}</td>
                    <td><span className="status-badge">{inv.status === "posted" ? t("purchases.invoices.posted") : t("purchases.invoices.draft")}</span></td>
                    <td className="row-actions">
                      <button className="icon-btn" title={t("purchases.invoices.view")} onClick={() => setViewInvoice(inv)}><Icon.Eye /></button>
                      <button
                        className="icon-btn" title={t("purchases.invoices.print")}
                        onClick={() => { setViewInvoice(inv); setAutoPrint(true); }}
                      ><Icon.Printer /></button>
                      {inv.status === "draft" && (
                        <>
                          <button className="icon-btn icon-btn-danger" title={t("purchases.invoices.delete")} onClick={() => remove(inv)}><Icon.Trash /></button>
                          <button className="icon-btn" title={t("purchases.invoices.post")} onClick={() => doPost(inv)}><Icon.Lock /></button>
                        </>
                      )}
                      {inv.status === "posted" && (
                        <button className="icon-btn icon-btn-warn" title={t("purchases.invoices.unpost")} onClick={() => setUnpostTarget(inv)}><Icon.Unlock /></button>
                      )}
                      <button
                        className="icon-btn" title={attachmentsFor === inv.id ? t("purchases.invoices.attachmentsHide") : t("purchases.invoices.attachmentsShow")}
                        onClick={() => setAttachmentsFor(attachmentsFor === inv.id ? null : inv.id)}
                      ><Icon.Paperclip /></button>
                    </td>
                  </tr>
                  {attachmentsFor === inv.id && (
                    <tr><td colSpan={6}><AttachmentsPanel entityType="purchase_invoice" entityId={inv.id} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              {invoices.length === 0 && <tr><td className="empty" colSpan={6}>{t("purchases.invoices.empty")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {unpostTarget && <UnpostModal onCancel={() => setUnpostTarget(null)} onConfirm={doUnpost} />}

      {viewInvoice && (
        <PurchaseInvoiceViewModal
          invoice={viewInvoice}
          companies={companies}
          autoPrint={autoPrint}
          onClose={() => { setViewInvoice(null); setAutoPrint(false); }}
        />
      )}
    </div>
  );
}
