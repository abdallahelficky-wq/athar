import { useEffect, useState } from "react";

/** يُعيد نسخة من value تتأخر delayMs عن كل تغيير — يُستخدَم لتأجيل تطبيق البحث السريع أثناء الكتابة
 * بدل إرسال طلب لكل حرف. مُعاد الاستخدام لأي حقل بحث فوري مستقبلاً، لا خاص بشاشة بعينها. */
export function useDebouncedValue(value, delayMs = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
