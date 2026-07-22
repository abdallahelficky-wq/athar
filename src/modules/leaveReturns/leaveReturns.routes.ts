import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { registerLeaveReturnSchema } from "./leaveReturns.schemas";
import { createHandler } from "./leaveReturns.controller";

export const leaveReturnRoutes = Router();
leaveReturnRoutes.use(authenticate);

leaveReturnRoutes.post("/", requireRole("admin", "finance_manager", "hr_manager"), validateBody(registerLeaveReturnSchema), createHandler);
