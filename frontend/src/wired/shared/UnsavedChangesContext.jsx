import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * آلية عامة لتتبّع "وجود تغييرات غير محفوظة" (Dirty State) عبر أي عدد من النماذج المفتوحة في
 * آنٍ واحد (مثلاً أكثر من Modal). كل نموذج يستدعي useUnsavedChangesGuard(isDirty) فيسجّل حالته
 * الخاصة في Set مشترك عبر Context؛ UnsavedChangesBlocker (المستهلِك الوحيد لـ useAnyUnsavedChanges)
 * يعترض التنقّل داخل التطبيق و/أو إغلاق التبويب طالما هذا الـ Set غير فارغ.
 */
const UnsavedChangesStateContext = createContext(null);

let nextGuardId = 0;

export function UnsavedChangesProvider({ children }) {
  const [dirtyIds, setDirtyIds] = useState(() => new Set());

  const setGuardDirty = useCallback((id, isDirty) => {
    setDirtyIds((prev) => {
      const has = prev.has(id);
      if (isDirty === has) return prev;
      const next = new Set(prev);
      if (isDirty) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const removeGuard = useCallback((id) => {
    setGuardDirty(id, false);
  }, [setGuardDirty]);

  const value = useMemo(() => ({ hasUnsaved: dirtyIds.size > 0, setGuardDirty, removeGuard }), [dirtyIds, setGuardDirty, removeGuard]);

  return <UnsavedChangesStateContext.Provider value={value}>{children}</UnsavedChangesStateContext.Provider>;
}

/** يسجّل حالة "معدَّل" لنموذج واحد. isDirty=true يمنع مغادرة الصفحة (تنقّل داخلي/إغلاق التبويب). */
export function useUnsavedChangesGuard(isDirty) {
  const ctx = useContext(UnsavedChangesStateContext);
  const idRef = useRef(null);
  if (idRef.current == null) idRef.current = `guard-${nextGuardId++}`;

  useEffect(() => {
    if (!ctx) return;
    ctx.setGuardDirty(idRef.current, isDirty);
  }, [ctx, isDirty]);

  // إزالة تسجيل هذا النموذج عند تفكيكه فقط (إغلاق النافذة) — لذلك مصفوفة الاعتماديات هنا فارغة
  // عمداً (mount/unmount فقط)، وليست [ctx]: ctx كائن جديد في كل مرة يتغيّر فيها Set التسجيل نفسه
  // (أي عند أي تغيير "معدَّل" لأي نموذج آخر بالنظام)، فلو اعتمد التنظيف على [ctx] لكان يُشغَّل خطأً
  // في كل مرة يتغيّر فيها المرجع لا عند الإزالة الفعلية فقط — ما يُنشئ حلقة إضافة/إزالة لا تنتهي
  // (رُصِد فعلياً أثناء الاختبار: عشرات نداءات render/blockerFn متتالية بلا استقرار). نحتفظ بأحدث
  // ctx عبر ref لتفادي إغلاق (closure) قديم عند التنظيف الفعلي.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  useEffect(() => () => { if (ctxRef.current) ctxRef.current.removeGuard(idRef.current); }, []);
}

/** هل يوجد أي نموذج مسجَّل حالياً بحالة "معدَّل"؟ يُستخدم فقط من UnsavedChangesBlocker. */
export function useAnyUnsavedChanges() {
  const ctx = useContext(UnsavedChangesStateContext);
  return ctx ? ctx.hasUnsaved : false;
}
