import { useCallback, useEffect, useState } from "react";
import { listCompanies } from "../api/companies";

/** يُحمَّل مرة واحدة على مستوى التطبيق، ويُشارَك بين كل الشاشات المرتبطة بالـ API الحقيقي */
export function useCompanies() {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCompanies();
      setCompanies(list);
      setCompanyId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const onCompanyCreated = (company) => {
    setCompanies((prev) => [...prev, company]);
    setCompanyId(company.id);
  };

  return { companies, companyId, setCompanyId, loading, reload, onCompanyCreated };
}
