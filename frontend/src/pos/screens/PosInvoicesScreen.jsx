import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchSalesInvoices } from "../../api/salesInvoices";
import { fmt2 } from "../../legacy/constants";
import { formatDateTime } from "../../i18n/dateFormat";
import PaginationBar from "../../wired/shared/PaginationBar";
import PosInvoiceViewModal from "../components/PosInvoiceViewModal";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

/**
 * قائمة فواتير هذه الشركة لجهاز نقطة البيع — بحث/ترقيم من جانب الخادم عبر نفس نقطة نهاية
 * GET /sales-invoices/search المستخدَمة في شاشة الفواتير الرئيسية (searchSalesInvoices)، لا نقطة
 * نهاية جديدة، مع companyId دائماً صريحاً فتبقى القائمة مقتصرة على شركة هذا الجهاز فقط (والمستأجر
 * ضمنياً عبر req.auth في الخادم بصرف النظر عمّا يُرسَل). أحدث فاتورة أولاً (الترتيب الافتراضي في
 * searchSalesInvoices نفسه)، وPaginationBar نفس المكوّن المشترك المستخدَم في شاشات القوائم الأخرى.
 */
export default function PosInvoicesScreen({ companyId, onBack }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [result, setResult] = useState({ items: [], totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openInvoiceId, setOpenInvoiceId] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    searchSalesInvoices(companyId, { page, pageSize })
      .then(setResult)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [companyId, page, pageSize]);

  const changePageSize = (size) => { setPageSize(size); setPage(1); };

  return (
    <div className="pos-invoices-screen">
      <div className="pos-invoices-header">
        <button className="pos-icon-btn" onClick={onBack}>‹</button>
        <span>{t("pos.invoices.title")}</span>
        <span />
      </div>

      {error && <p className="m-error">{error}</p>}
      {loading && <p className="m-empty">{t("common.loading")}</p>}

      {!loading && result.items.length === 0 && <p className="m-empty">{t("pos.invoices.empty")}</p>}

      <div className="pos-invoices-list">
        {result.items.map((row) => (
          <button key={row.id} className="pos-invoices-row" onClick={() => setOpenInvoiceId(row.id)}>
            <div className="pos-invoices-row-main">
              <span className="pos-invoices-row-number">{row.invoiceNumber}</span>
              <span className="pos-invoices-row-time">{formatDateTime(row.date, i18n.language)}</span>
            </div>
            <div className="pos-invoices-row-side">
              <span className="pos-invoices-row-total">{fmt2(Number(row.grandTotal))}</span>
              <span className={`pos-invoices-row-status pos-invoices-row-status-${row.paymentStatus === "مسددة" ? "paid" : row.paymentStatus === "مسددة جزئياً" ? "partial" : "unpaid"}`}>
                {row.paymentStatus}
              </span>
            </div>
          </button>
        ))}
      </div>

      {result.totalCount > 0 && (
        <PaginationBar
          page={page}
          pageSize={pageSize}
          totalCount={result.totalCount}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={setPage}
          onPageSizeChange={changePageSize}
        />
      )}

      {openInvoiceId && (
        <PosInvoiceViewModal invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} />
      )}
    </div>
  );
}
