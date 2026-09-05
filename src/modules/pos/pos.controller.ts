import { RequestHandler } from "express";
import { forbidden } from "../../lib/httpError";
import { hasPermission } from "../../middleware/auth";
import { createPosSale, getQuickAccessItems } from "./pos.service";

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
  const { companyId } = req.query;
  if (typeof companyId !== "string") {
    res.json([]);
    return;
  }
  const items = await getQuickAccessItems(req.auth!.tenantId, companyId);
  res.json(items);
};
