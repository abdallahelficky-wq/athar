import { Router } from "express";
import { authenticate, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { registerLeaveReturnSchema } from "./leaveReturns.schemas";
import { createHandler } from "./leaveReturns.controller";

export const leaveReturnRoutes = Router();
leaveReturnRoutes.use(authenticate, blockMutationsWhenReadOnly);

leaveReturnRoutes.post("/", requireRole("admin", "finance_manager", "hr_manager"), validateBody(registerLeaveReturnSchema), createHandler);
