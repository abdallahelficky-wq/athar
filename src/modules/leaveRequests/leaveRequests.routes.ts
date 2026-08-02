import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaveRequestSchema } from "./leaveRequests.schemas";
import {
  listLeaveRequests, createLeaveRequest, deleteLeaveRequest, approveLeaveRequestHandler, rejectLeaveRequestHandler,
} from "./leaveRequests.controller";

export const leaveRequestRoutes = Router();
leaveRequestRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

leaveRequestRoutes.get("/", listLeaveRequests);
leaveRequestRoutes.post("/", canWrite, validateBody(createLeaveRequestSchema), createLeaveRequest);
leaveRequestRoutes.post("/:id/approve", canWrite, approveLeaveRequestHandler);
leaveRequestRoutes.post("/:id/reject", canWrite, rejectLeaveRequestHandler);
leaveRequestRoutes.delete("/:id", canWrite, deleteLeaveRequest);
