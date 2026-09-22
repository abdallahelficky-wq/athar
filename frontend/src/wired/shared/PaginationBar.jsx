import React from "react";
import { useTranslation } from "react-i18next";

/**
 * شريط ترقيم صفحات عام (بلا أي معرفة بشكل البيانات المعروضة) — مُعاد استخدامه لاحقاً لشاشات
 * قائمة أخرى (مردودات، سندات قبض، عروض أسعار) بمجرد ربطها بنفس نمط {page, pageSize, totalCount}.
 */
export default function PaginationBar({ page, pageSize, totalCount, pageSizeOptions, onPageChange, onPageSizeChange }) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(totalCount, page * pageSize);

  return (
    <div className="pagination-bar">
      <label className="pagination-page-size">
        {t("pagination.pageSizeLabel")}
        <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </label>

      <span className="pagination-range">
        {totalCount === 0 ? t("pagination.showingEmpty") : t("pagination.showingRange", { from, to, total: totalCount })}
      </span>

      <div className="pagination-nav">
        <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          {t("pagination.prev")}
        </button>
        <span className="pagination-page-of">{t("pagination.pageOf", { page, totalPages })}</span>
        <button type="button" className="btn-secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          {t("pagination.next")}
        </button>
      </div>
    </div>
  );
}
