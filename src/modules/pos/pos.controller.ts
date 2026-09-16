import { RequestHandler } from "express";
import { forbidden } from "../../lib/httpError";
import { hasPermission } from "../../middleware/auth";
import { createPosSale, getQuickAccessItems, listPosFavoriteItems, addPosFavoriteItem, removePosFavoriteItem } from "./pos.service";

/**
 * الفحص الحاسم فعلياً لصلاحية "البيع الآجل" — لا يُطبَّق كـ middleware عام على المسار بأكمله لأنه
 * يخدم البيع العادي والآجل معاً؛ يُشرَط هنا فقط حين تكون الفاتورة آجلة فعلاً (payments فارغة)، فلا
 * يُطلَب من كاشير عادي أي صلاحية إضافية لبيع مدفوع بالكامل. مؤشّر canDeferPosSale في استجابة auth
 * (auth.service.ts) لتجربة استخدام أفضل فقط (يُخفي التبويب من الواجهة أصلاً)؛ هذا التحقق هو ما يمنع
 * فعلياً أي التفاف على الواجهة.
 */
export const createPosSaleHandler: RequestHandler = async (req, res) => {
  const isDeferred = Array.isArray(req.body.payments) && req.body.payments.length === 0;
  if (isDeferred && !(await hasPermission(req.auth!, "sales", "posDeferredSale"))) {
    throw forbidden("منصبك الوظيفي لا يملك صلاحية تسجيل بيع آجل (بلا دفع) في نقطة البيع");
  }
  const result = await createPosSale(req.auth!.tenantId, req.auth!.sub, req.body);
  res.status(201).json(result);
};

export const quickAccessItemsHandler: RequestHandler = async (req, res) => {
  const { companyId, warehouseId } = req.query;
  if (typeof companyId !== "string" || typeof warehouseId !== "string") {
    res.json([]);
    return;
  }
  const items = await getQuickAccessItems(req.auth!.tenantId, companyId, warehouseId);
  res.json(items);
};

export const listFavoritesHandler: RequestHandler = async (req, res) => {
  const { companyId, warehouseId } = req.query;
  if (typeof companyId !== "string" || typeof warehouseId !== "string") {
    res.json([]);
    return;
  }
  const items = await listPosFavoriteItems(req.auth!.tenantId, companyId, warehouseId);
  res.json(items);
};

export const addFavoriteHandler: RequestHandler = async (req, res) => {
  const favorite = await addPosFavoriteItem(req.auth!.tenantId, req.body.companyId, req.body.warehouseId, req.body.itemId);
  res.status(201).json(favorite);
};

export const removeFavoriteHandler: RequestHandler = async (req, res) => {
  await removePosFavoriteItem(req.auth!.tenantId, req.params.warehouseId, req.params.itemId);
  res.status(204).send();
};
