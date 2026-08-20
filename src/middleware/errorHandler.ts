import { ErrorRequestHandler } from "express";
import { HttpError } from "../lib/httpError";
import { Prisma } from "@prisma/client";
import { translateMessage, translateZodDetails } from "../lib/i18n/translate";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const lang = req.lang ?? "ar";

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: translateMessage(err.message, lang),
      details: translateZodDetails(err.details, lang),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: translateMessage("قيمة مكررة تنتهك قيداً فريداً", lang), details: err.meta });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: translateMessage("العنصر غير موجود", lang) });
      return;
    }
    if (err.code === "P2003") {
      res.status(409).json({ error: translateMessage("لا يمكن حذف هذا العنصر لارتباطه بسجلات أخرى", lang) });
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: translateMessage("خطأ داخلي في الخادم", lang) });
};
