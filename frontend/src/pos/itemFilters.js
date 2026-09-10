// يحدّد الأصناف القابلة للبيع في نقطة البيع (مطابق لقاعدة raw_material/allowDirectSale في
// salesInvoices.service.ts) — مشترك بين SaleScreen وQuickSaleScreen حتى لا يفترق المنطق بينهما.
export function isSellableItem(item) {
  if (item.type === "expense" || item.type === "fixed_asset") return false;
  if (item.type === "raw_material") return item.allowDirectSale === true;
  return true;
}
