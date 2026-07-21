import { ErrorRequestHandler } from "express";
import { HttpError } from "../lib/httpError";
import { Prisma } from "@prisma/client";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "قيمة مكررة تنتهك قيداً فريداً", details: err.meta });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "العنصر غير موجود" });
      return;
    }
    if (err.code === "P2003") {
      res.status(409).json({ error: "لا يمكن حذف هذا العنصر لارتباطه بسجلات أخرى" });
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "خطأ داخلي في الخادم" });
};
