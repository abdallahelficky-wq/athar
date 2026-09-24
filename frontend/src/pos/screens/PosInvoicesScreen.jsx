import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchSalesInvoices } from "../../api/salesInvoices";
import { fmt2 } from "../../legacy/constants";
import { formatDateTime } from "../../i18n/dateFormat";
import PaginationBar from "../../wired/shared/PaginationBar";
import PosInvoiceViewModal from "../components/PosInvoiceViewModal";

// يجب أن تكون كل قيمة هنا من SEARCH_PAGE_SIZES (راجع src/lib/searchPagination.ts في الخادم) —
// عطل إنتاج فعلي مؤكَّد: كانت القيمة الافتراضية هنا 20 (غير مسموحة، القيم المتاحة فقط
// [15, 25, 50, 100, 200])، فكان *كل* طلب أول لهذه الشاشة يُرفَض فوراً بخطأ التحقق قبل الوصول لقاعدة
// البيانات إطلاقاً (راجع searchHandler في salesInvoices.controller.ts)، فتظهر القائمة فارغة دوماً
// رغم وجود فواتير مرحّلة فعلياً — يُثبِته اختبار الـschema القائم فعلاً
// (salesInvoicesSearch.schema.test.ts: "rejects disallowed pageSize" يتضمن 20 صراحة ضمن القيم
// المرفوضة). لا تُغيَّر هذه القيم مجدداً بلا التحقق من نفس الثابت المشترك أولاً.
const PAGE_SIZE_OPTIONS = [15, 25, 50];

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
  const [pageSize, setPageSize] = useState(15);
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

  // يدفع إدخال سجل تصفّح واحداً عند فتح هذه الشاشة، حتى يصبح زر الرجوع الفعلي في جهاز أندرويد
  // (راجع onBackPressedDispatcher في MainActivity.kt: يستدعي webView.goBack() لو كان هناك سجل
  // تصفّح فعلاً، وإلا يُغلِق التطبيق مباشرة) قادراً على "الرجوع" فعلياً لشاشة البيع، بدل إغلاق
  // التطبيق كاملاً من داخل شاشة الفواتير — لا يوجد Router في تطبيق نقطة البيع أصلاً (راجع
  // pos-main.jsx)، فآلة الحالة screen في PosApp.jsx وحدها لا تترك أي أثر في سجل التصفّح ليعمل معه
  // الزر الفعلي. onBackRef يتجنّب إعادة تشغيل هذا الأثر (وبالتالي دفع سجل جديد) في كل مرة يُعاد
  // فيها بناء onBack من الأب (دالة سهمية جديدة كل تصيير)، مع إبقاء onBack نفسها محدَّثة دوماً.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    window.history.pushState({ posInvoicesScreen: true }, "");
    const handlePopState = () => onBackRef.current();
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      // غادرنا الشاشة بطريقة أخرى غير زر الرجوع (مثال: ضغط "إعدادات"/"تسجيل خروج" من الشريط
      // العلوي، الظاهر فوق كل الشاشات) — سجل التصفّح الذي دفعناه لا يزال قائماً؛ نُزيله بأنفسنا
      // حتى لا يبقى إدخالاً "شبحاً" يُفسِد ضغطة الزر الفعلي التالية من شاشة أخرى غير هذه. لو
      // غادرنا فعلاً عبر popstate (المستخدم ضغط الزر فعلاً)، الإدخال يكون قد أُزيل بالفعل ولن
      // تحمل window.history.state علامتنا بعد الآن، فلا داعي لفعل شيء إضافي هنا.
      if (window.history.state?.posInvoicesScreen) window.history.back();
    };
  }, []);

  // نفس مسار الرجوع بالضبط لزر الشاشة والزر الفعلي (history.back() يُطلِق popstate الذي يستدعي
  // onBack فعلياً أعلاه) — مسار واحد لا مساران منفصلان قد ينحرفان عن بعضهما لاحقاً.
  const goBack = () => window.history.back();

  const changePageSize = (size) => { setPageSize(size); setPage(1); };

  return (
    <div className="pos-invoices-screen">
      <div className="pos-invoices-header">
        <button className="pos-icon-btn" onClick={goBack}>‹</button>
        <span>{t("pos.invoices.title")}</span>
        <span />
      </div>

      {error && <p className="m-error">{error}</p>}
      {loading && <p className="m-empty">{t("common.loading")}</p>}

      {!loading && !error && result.items.length === 0 && <p className="m-empty">{t("pos.invoices.empty")}</p>}

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
