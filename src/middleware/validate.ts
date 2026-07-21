import { RequestHandler } from "express";
import { ZodSchema } from "zod";
import { badRequest } from "../lib/httpError";

/** يتحقق من body الطلب وفق مخطط zod، ويستبدل req.body بالنسخة المُحلَّلة والمنظّفة */
export function validateBody(schema: ZodSchema): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw badRequest("بيانات الطلب غير صالحة", result.error.flatten());
    }
    req.body = result.data;
    next();
  };
}
