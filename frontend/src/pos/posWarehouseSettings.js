// المستودع المرتبط بهذا الجهاز تحديداً، لكل شركة على حدة — يُحفَظ محلياً في localStorage بنفس
// فلسفة إعداد الطابعة (shared/receipt/posLocalSettings.js): لا مزامنة مع الخادم، فتابلت محطة
// الجوهرة وموبايل محطة تنومة يحتفظ كل منهما بمستودعه الخاص بلا تعارض بينهما. مفتاح واحد يخزّن
// خريطة { companyId: warehouseId } لأن نفس الجهاز قد يُستخدَم (نادراً) لأكثر من شركة.
const KEY = "athar.posWarehouseByCompany";

function loadMap() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadPosWarehouseId(companyId) {
  if (!companyId) return null;
  return loadMap()[companyId] || null;
}

export function savePosWarehouseId(companyId, warehouseId) {
  const map = loadMap();
  map[companyId] = warehouseId;
  localStorage.setItem(KEY, JSON.stringify(map));
}
