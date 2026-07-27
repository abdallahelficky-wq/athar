// نظام ألوان موحّد للرسوم البيانية (recharts) في كل الداشبوردات، مطابق لهوية التطبيق
// البصرية الحالية (الذهبي/الكحلي/الأخضر الزيتي مقابل الأحمر الطوبي للسلبي) بدل ألوان recharts
// الافتراضية، حتى تبدو الرسوم جزءاً من نفس النظام لا مكتبة خارجية مُلصَقة.
export const CHART_COLORS = {
  gold: "#B98B4E",
  navy: "#10202E",
  slate: "#445565",
  teal: "#2F5D5A",
  rust: "#A8432B",
  brown: "#8A5A2E",
  cream: "#ECE6D6",
};

export const CHART_PALETTE = [
  "#B98B4E", "#2F5D5A", "#10202E", "#8A5A2E", "#445565", "#A8432B", "#8A7C5E", "#6B7C8C",
];

export const CHART_GRID = "rgba(16,32,46,0.1)";
export const CHART_AXIS = "#445565";
export const CHART_FONT = "'IBM Plex Sans Arabic', sans-serif";

export const chartTooltipStyle = {
  contentStyle: {
    fontFamily: CHART_FONT,
    fontSize: 12.5,
    borderRadius: 8,
    border: "1px solid rgba(16,32,46,0.15)",
    background: "#FBF9F3",
    direction: "rtl",
  },
  labelStyle: { color: CHART_COLORS.navy, fontWeight: 600 },
};

export function colorAt(index) {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}
