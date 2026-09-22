import React from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fmt2 } from "../../legacy/constants";
export default function InvoiceCreditNotes({ invoice, onClose }) {
 const { t } = useTranslation(); const navigate = useNavigate();
 const notes = (invoice.creditNotes || []).filter((note) => note.status !== "draft");
 const openReturn = () => { onClose?.(); navigate(`/sales/returns?invoiceId=${encodeURIComponent(invoice.id)}`); };
 return <section className="no-print" style={{ padding: 16, marginTop: 16, border: "1px solid #ddd", borderRadius: 8 }}>
  {notes.length > 0 && <><h4>↩ {t("creditNote.title")}</h4>
   <p>{t("creditNote.returned")}: {fmt2(Number(invoice.returnedAmount || 0))} — {t("creditNote.net")}: {fmt2(Number(invoice.netGrandTotal ?? invoice.grandTotal))} — {t("creditNote.due")}: {fmt2(Number(invoice.outstandingAmount || 0))}</p>
   {Number(invoice.customerCreditAmount) > 0 && <p>{t("creditNote.customerCredit")}: {fmt2(Number(invoice.customerCreditAmount))}</p>}
   <ul>{notes.map((note) => <li key={note.id}><strong>{note.returnNumber}</strong> — {fmt2(Number(note.grandTotal))} — {note.reason} {note.status !== "posted" && `(${t("creditNote.pending")})`}</li>)}</ul>
  </>}
  {invoice.status === "posted" && invoice.returnStatus !== "full" && <button type="button" className="btn-secondary" onClick={openReturn}>↩ {t("creditNote.returnInvoice")}</button>}
 </section>;
}
