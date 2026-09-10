import React, { useState } from "react";

/**
 * حقل كمية قابل للكتابة المباشرة (يدعم كسوراً عشرية — النظام يقبلها فعلياً في فواتير المبيعات،
 * quantity عمود Decimal(18,4) بلا أي قيد .int() في المخطط)، بجانب أزرار +/- الخارجية التي لا يديرها
 * هذا المكوّن إطلاقاً (تبقى كما هي، تُعدِّل قيمة الكمية في حالة الأب مباشرة بخطوة ١ ثابتة).
 *
 * "مسودة" نصية داخلية مستقلة تماماً عن value الممرَّرة طوال فترة التركيز: تسمح بالحذف الكامل مؤقتاً
 * (حقل فارغ أثناء الكتابة) بلا أي قفز تلقائي لـ1 أو 0، وتُستبدَل بـvalue الفعلية فقط بعد مغادرة الحقل
 * (blur) — عندها فقط تُطبَّق القيمة الدنيا (min، افتراضياً 1): أي قيمة غير صالحة (فارغة/سالبة/صفر/أقل
 * من min) تُثبَّت على min بدل حذف السطر (الحذف الفعلي عبر زر "حذف" المستقل، لا بكتابة صفر).
 * أثناء الكتابة نفسها لا تُطبَّق القيمة الدنيا (فقط "أكبر من صفر") حتى لا يُرفَض أول رقم من كسر
 * عشري مشروع (مثال: كتابة "1.5" رقماً برقم)، فيتحدّث الإجمالي فورياً مع كل ضغطة تُنتج رقماً صالحاً.
 */
export default function QtyInput({ value, min = 1, onChange, className = "pos-qty-input" }) {
  const [draft, setDraft] = useState(null); // null = غير قيد التعديل، اعرض value مباشرة

  const displayValue = draft ?? String(value);

  const handleChange = (e) => {
    const raw = e.target.value;
    setDraft(raw);
    const parsed = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(parsed) && parsed > 0) {
      onChange(parsed);
    }
  };

  const handleBlur = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    const finalValue = Number.isFinite(parsed) && parsed >= min ? parsed : min;
    onChange(finalValue);
    setDraft(null);
  };

  return (
    <input
      className={className}
      type="number"
      inputMode="decimal"
      min={min}
      step="any"
      value={displayValue}
      onChange={handleChange}
      onFocus={(e) => e.target.select()}
      onBlur={handleBlur}
    />
  );
}
