import { useCallback, useEffect, useState } from "react";
import { listCompanies } from "../api/companies";
import { useAuth } from "../context/AuthContext";

const storageKeyFor = (tenantId) => (tenantId ? `athar.activeCompanyId.${tenantId}` : null);

/**
 * يُحمَّل مرة واحدة على مستوى التطبيق، ويُشارَك بين كل الشاشات المرتبطة بالـ API الحقيقي —
 * هذا هو "سياق الشركة النشطة" الوحيد في النظام: يُختار من أيقونات الشركات في الشاشة الرئيسية
 * فقط، ويُحفَظ محلياً (لكل مستأجر على حدة) ليبقى ثابتاً عبر إعادة تحميل الصفحة بدل الرجوع
 * دائماً لأول شركة في القائمة.
 */
export function useCompanies() {
  const { tenant } = useAuth();
  const storageKey = storageKeyFor(tenant?.id);

  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyIdState] = useState(() => (storageKey ? localStorage.getItem(storageKey) : null));
  const [loading, setLoading] = useState(true);

  const setCompanyId = useCallback(
    (id) => {
      setCompanyIdState(id);
      if (!storageKey) return;
      if (id) localStorage.setItem(storageKey, id);
      else localStorage.removeItem(storageKey);
    },
    [storageKey],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCompanies();
      setCompanies(list);
      setCompanyIdState((prev) => {
        const next = prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null;
        if (storageKey) {
          if (next) localStorage.setItem(storageKey, next);
          else localStorage.removeItem(storageKey);
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onCompanyCreated = (company) => {
    setCompanies((prev) => [...prev, company]);
    setCompanyId(company.id);
  };

  return { companies, companyId, setCompanyId, loading, reload, onCompanyCreated };
}
