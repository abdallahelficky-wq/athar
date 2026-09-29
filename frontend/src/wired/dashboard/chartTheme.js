// نظام ألوان موحّد للرسوم البيانية (recharts) في كل الداشبوردات، مطابق لهوية التطبيق
// البصرية الحالية (الذهبي/الكحلي/الأخضر الزيتي مقابل الأحمر الطوبي للسلبي) بدل ألوان recharts
// الافتراضية، حتى تبدو الرسوم جزءاً من نفس النظام لا مكتبة خارجية مُلصَقة.
export const CHART_COLORS = {
  gold: "#d4af37",
  navy: "#212529",
  slate: "#495057",
  teal: "#2b8a3e",
  rust: "#A8432B",
  brown: "#8A5A2E",
  cream: "#ECE6D6",
};

export const CHART_PALETTE = [
  "#d4af37", "#2b8a3e", "#212529", "#8A5A2E", "#495057", "#A8432B", "#8A7C5E", "#6B7C8C",
];

export const CHART_GRID = "rgba(16,32,46,0.1)";
export const CHART_AXIS = "#495057";
export const CHART_FONT = "'Tajawal', sans-serif";

export const chartTooltipStyle = {
  contentStyle: {
    fontFamily: CHART_FONT,
    fontSize: 12.5,
    borderRadius: 8,
    border: "1px solid rgba(16,32,46,0.15)",
    background: "#ffffff",
    direction: "rtl",
  },
  labelStyle: { color: CHART_COLORS.navy, fontWeight: 600 },
};

export function colorAt(index) {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}

// لوحة الداشبورد التفاعلية الجديدة (--athar-*) — تُستخدَم فقط للرسوم المُعاد تصميمها بهذه الهوية
// (مثل تعبئة الاتجاه المتدرجة تحت خط اتجاه المبيعات)، منفصلة عمداً عن CHART_PALETTE أعلاه حتى لا
// تتغيّر ألوان الرسوم الأخرى غير المقصودة بهذا التحديث.
export const ATHAR_ACCENT_BLUE = "#b8860b";
export const ATHAR_ACCENT_GREEN = "#10b981";
