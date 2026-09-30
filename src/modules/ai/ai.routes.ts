import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../../middleware/auth";
import { askAiHandler } from "./ai.controller";
import { HttpError } from "../../lib/httpError";
import { prisma } from "../../lib/prisma";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export const aiRoutes = Router();

aiRoutes.use(authenticate);

const validateAskRequest = async (req: Request, res: Response, next: NextFunction) => {
  const { question, context, dateFrom, dateTo, companyId, tenantId, companyScope } = req.body;

  // 1. Validate question (400)
  if (!question || typeof question !== "string" || question.trim().length === 0 || question.length > 4000) {
    return next(new HttpError(400, "Invalid question"));
  }

  // 2. Reject arbitrary context (400)
  if (context !== undefined && context !== null) {
    if (typeof context !== "object" || Object.keys(context).length > 0) {
      return next(new HttpError(400, "Invalid context"));
    }
  }

  // 3. Reject tenantId/companyScope in body (400)
  if (tenantId !== undefined || companyScope !== undefined) {
    return next(new HttpError(400, "Invalid request"));
  }

  // 4. Validate dates (400)
  if (dateFrom !== undefined || dateTo !== undefined) {
    if (dateFrom !== undefined) {
      const from = new Date(dateFrom);
      if (isNaN(from.getTime())) {
        return next(new HttpError(400, "Invalid date range"));
      }
    }
    if (dateTo !== undefined) {
      const to = new Date(dateTo);
      if (isNaN(to.getTime())) {
        return next(new HttpError(400, "Invalid date range"));
      }
    }
    if (dateFrom !== undefined && dateTo !== undefined) {
      const from = new Date(dateFrom);
      const to = new Date(dateTo);
      if (from > to) {
        return next(new HttpError(400, "Invalid date range"));
      }
    }
  }

  // 5. Decode token to get scope claims
  const authHeader = req.headers.authorization;
  let user: any = null;
  
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      user = jwt.verify(token, env.jwtAccessSecret);
    } catch (e) {
      // Token invalid or expired
    }
  }

  // 6. Check scope claims (401)
  if (!user?.companyScope || !user?.tenantId ||
      user.companyScope.trim() === "" || user.tenantId.trim() === "") {
    return next(new HttpError(401, "Missing scope claims"));
  }

  // 7. Handle companyId (403/404)
  if (companyId !== undefined) {
    if (user.companyScope !== "all") {
      return next(new HttpError(403, "Cannot select company"));
    }
    const company = await prisma.company.findFirst({
      where: { id: companyId, tenantId: user.tenantId },
      select: { id: true }
    });
    if (!company) {
      return next(new HttpError(404, "Company not found"));
    }
  }

  next();
};

aiRoutes.post("/ask", validateAskRequest, askAiHandler);
