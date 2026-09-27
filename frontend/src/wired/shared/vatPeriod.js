import { useEffect, useState } from "react";

// السعودية بلا توقيت صيفي — اليوم التقويمي بتوقيت الرياض (+3)، مطابقاً لحدود الفترة على الخادم
// (src/lib/vatPeriod.ts) حتى لا يُحسَب "الشهر السابق" من يوم UTC مختلف قرب منتصف الليل.
const riyadhToday = (now = new Date()) => new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, "0");

/**
 * آخر فترة إقرار مكتملة: الشهر السابق للشهري، والربع التقويمي السابق للربعي — نفس حساب الخادم
 * (lastCompleteFilingPeriod في src/lib/vatPeriod.ts).
 */
export function lastCompleteFilingPeriod(frequency, now = new Date()) {
  const [y, m] = riyadhToday(now).split("-").map(Number);
  const monthsBack = frequency === "monthly" ? 1 : ((m - 1) % 3) + 3;
  const span = frequency === "monthly" ? 1 : 3;
  const startIndex = y * 12 + (m - 1) - monthsBack;
  const endIndex = startIndex + span - 1;
  const endY = Math.floor(endIndex / 12);
  const endM = (endIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(endY, endM, 0)).getUTCDate();
  return {
    from: `${Math.floor(startIndex / 12)}-${pad((startIndex % 12) + 1)}-01`,
    to: `${endY}-${pad(endM)}-${pad(lastDay)}`,
  };
}

/**
 * فترة الإقرار المعروضة في شاشات الضريبة: تبدأ بآخر فترة مكتملة حسب دورية إقرار الشركة. الحالة
 * مفتاحها الشركة ودوريتها معاً، فعند تغيير الشركة تُشتَق الفترة الجديدة في نفس الرسم (لا في effect
 * لاحق) — فلا يُرسَل أبداً طلب للشركة الجديدة بفترة الشركة السابقة. `draft` ما في الحقلين، و`applied`
 * ما يُرسَل فعلاً للخادم بعد "عرض".
 */
export function useVatPeriod(company) {
  const frequency = company?.vatFilingFrequency || "quarterly";
  const key = `${company?.id || ""}|${frequency}`;
  const [state, setState] = useState(() => {
    const p = lastCompleteFilingPeriod(frequency);
    return { key, draft: p, applied: p };
  });
  let current = state;
  if (state.key !== key) {
    const p = lastCompleteFilingPeriod(frequency);
    current = { key, draft: p, applied: p };
    setState(current);
  }
  return {
    frequency,
    key,
    draft: current.draft,
    applied: current.applied,
    setField: (field, value) => setState((s) => ({ ...s, draft: { ...s.draft, [field]: value } })),
    apply: () => setState((s) => ({ ...s, applied: s.draft })),
  };
}

/**
 * يجلب بيانات شاشة ضريبية ويتجاهل أي رد وصل بعد تغيّر الطلب (شركة أو فترة أخرى) — آخر طلب وحده
 * يُعرَض، مهما كان ترتيب وصول الردود.
 */
export function useVatFetch(fetcher, companyId, applied) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!companyId) return undefined;
    let live = true;
    setData(null);
    setError("");
    fetcher({ companyId, ...applied })
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [companyId, applied.from, applied.to]);
  return { data, error };
}
