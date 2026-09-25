import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * يُبقي كائن حالة (فلاتر/ترتيب/ترقيم صفحات) مُزامَناً مع سلسلة استعلام الرابط — التحديث يستبدل
 * سجل التصفح الحالي (replace) لا يضيف سجلاً جديداً في كل كتابة حرف، فيبقى زر "رجوع" في المتصفح
 * مفيداً بدل أن يتنقّل حرفاً حرفاً. أي مفتاح بقيمته الافتراضية يُحذف من الرابط بدل كتابته صراحةً،
 * فيبقى الرابط قصيراً ونظيفاً في الحالة الشائعة (بلا فلاتر). القيم تُحوَّل تلقائياً لنفس نوع
 * قيمتها الافتراضية (رقم/نص) عند القراءة من الرابط.
 *
 * مُعاد الاستخدام لأي شاشة قائمة قابلة للفلترة/الترقيم مستقبلاً (مردودات، سندات قبض، عروض أسعار)،
 * لا خاص بفواتير المبيعات.
 */
export function useUrlQueryState(defaults) {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (!searchParams.has(key)) continue;
      const raw = searchParams.get(key);
      result[key] = typeof defaults[key] === "number" ? Number(raw) || defaults[key] : raw;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setState = useCallback(
    (patch) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const merged = { ...state, ...patch };
          for (const key of Object.keys(defaults)) {
            const value = merged[key];
            if (value === undefined || value === "" || value === defaults[key]) next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setSearchParams, state],
  );

  return [state, setState];
}
