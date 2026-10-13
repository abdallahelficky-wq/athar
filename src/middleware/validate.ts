import { RequestHandler } from "express";
import { ZodSchema } from "zod";
import { badRequest } from "../lib/httpError";
import { currentRequestContext } from "../lib/requestContext";
import { recheckRouteSubscriptionAfterBody } from "./subscriptionEnforcement";

/** يتحقق من body الطلب وفق مخطط zod، ويستبدل req.body بالنسخة المُحلَّلة والمنظّفة */
export function validateBody(schema: ZodSchema): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw badRequest("بيانات الطلب غير صالحة", result.error.flatten());
    }
    req.body = result.data;
    // جسم multipart لم يكن مقروءاً وقت الفحص المسبق للاشتراك — يُعاد الفحص الآن قبل المعالج (P4)
    const ctx = currentRequestContext();
    if (ctx && ctx.writeResources.size > 0 && req.is("multipart/form-data")) {
      return recheckRouteSubscriptionAfterBody(req, ctx.writeResources).then(() => next());
    }
    next();
  };
}
