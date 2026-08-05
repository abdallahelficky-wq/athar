import { useCallback, useState } from "react";

/**
 * حالة فلاتر "مؤجَّلة": القيم المكتوبة في الحقول (draft) تتغيّر فوراً مع كل onChange (فحقول الإدخال
 * تبقى Controlled وتعرض ما يكتبه المستخدم لحظياً)، لكن القيم الفعلية المستخدمة للجلب/الفلترة
 * (applied) لا تتغيّر إلا عند استدعاء apply() صراحةً — بالضغط على زرار "إظهار النتائج" أو Enter داخل
 * أحد حقول الفلتر. هذا يمنع مشكلة الفلترة التلقائية أثناء الكتابة (مثل تاريخ لسه مش مكتمل).
 *
 * الاستخدام المعتاد: مرّر draft/setField لحقول النموذج، واستخدم applied كتبعية للـ useEffect
 * الذي يجلب البيانات أو يفلتر القائمة، ولفّ حقول الفلتر في <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
 * حتى يعمل مفتاح Enter تلقائياً من أي حقل بداخله.
 */
export function useDeferredFilters(initialValues) {
  const [draft, setDraft] = useState(initialValues);
  const [applied, setApplied] = useState(initialValues);

  const setField = useCallback((key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const apply = useCallback(() => {
    setDraft((current) => {
      setApplied(current);
      return current;
    });
  }, []);

  const reset = useCallback((resetValues = initialValues) => {
    setDraft(resetValues);
    setApplied(resetValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { draft, applied, setField, setDraft, apply, reset };
}
