import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../../middleware/auth";
import { askAiHandler } from "./ai.controller";
import { HttpError } from "../../lib/httpError";

export const aiRoutes = Router();

aiRoutes.use(authenticate);

const validateAskRequest = (req: Request, res: Response, next: NextFunction) => {
  const { question, context, dateFrom, dateTo } = req.body;

  if (!question || typeof question !== "string" || question.trim().length === 0 || question.length > 4000) {
    return next(new HttpError(400, "Invalid question"));
  }

  if (context && typeof context !== "object") {
    return next(new HttpError(400, "Invalid context"));
  }

  if (dateFrom && dateTo) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
      return next(new HttpError(400, "Invalid date range"));
    }
  }

  const user = req.user as any;
  if (!user?.companyScope || !user?.tenantId) {
    return next(new HttpError(401, "Missing scope claims"));
  }

  next();
};

aiRoutes.post("/ask", validateAskRequest, askAiHandler);
