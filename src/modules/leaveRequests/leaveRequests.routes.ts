import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaveRequestSchema } from "./leaveRequests.schemas";
import { listLeaveRequests, createLeaveRequest, deleteLeaveRequest } from "./leaveRequests.controller";

export const leaveRequestRoutes = Router();
leaveRequestRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

leaveRequestRoutes.get("/", listLeaveRequests);
leaveRequestRoutes.post("/", canWrite, validateBody(createLeaveRequestSchema), createLeaveRequest);
leaveRequestRoutes.delete("/:id", canWrite, deleteLeaveRequest);
