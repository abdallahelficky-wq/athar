import React from "react";
import InvoiceZatcaDetails from "./InvoiceZatcaDetails";
import ZatcaHistoryPanel from "./ZatcaHistoryPanel";
import { shouldShowZatcaHistory } from "./zatcaHistoryState";

/**
 * قسم زاتكا للشاشة فقط (حالة زاتكا + سجل الإصدارات والمحاولات + زر إعادة الإصدار) — يُركَّب في كل قوالب عرض الفاتورة
 * وإشعار الدائن (modern عبر PrintShell.outsidePrint، وclassicPro عبر zatcaSection في ClassicProInvoiceView)، دائماً خارج
 * منطقة الطباعة وبصنف no-print: لا يظهر في الطباعة ولا في PDF (الذي يُولَّد في الخادم أصلاً).
 * سابقاً كان قالب classicPro لا يركّبه إطلاقاً (InvoiceViewModal يُسلِّم العرض كله له)، فلا سجل ولا زر لشركات ذلك القالب.
 */
export default function DocumentZatcaSection({ basePath, document, notify, onReissued }) {
  if (!document || document.zatcaStatus === "not_applicable" || !document.zatcaStatus) return null;
  return (
    <div className="no-print zatca-section" data-testid="zatca-section">
      <InvoiceZatcaDetails invoice={document} />
      {shouldShowZatcaHistory(document) && (
        <ZatcaHistoryPanel basePath={basePath} document={document} notify={notify} onReissued={onReissued} />
      )}
    </div>
  );
}
