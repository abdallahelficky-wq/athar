import { Router } from "express";
import { authenticateEmployeePortal } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaveRequestSchema } from "./leaveRequests.schemas";
import * as service from "./leaveRequests.service";

export const leaveRequestPortalRoutes = Router();
leaveRequestPortalRoutes.use(authenticateEmployeePortal);

leaveRequestPortalRoutes.get("/", async (req, res) => {
  res.json(await service.listOwnLeaveRequests(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId));
});

leaveRequestPortalRoutes.get("/balance", async (req, res) => {
  res.json(await service.leaveBalance(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId));
});

leaveRequestPortalRoutes.post("/", validateBody(createLeaveRequestSchema.omit({ employeeId: true })), async (req, res) => {
  const request = await service.createLeaveRequestFor(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId, req.body);
  res.status(201).json(request);
});

/** طلبات فريق المدير المباشر المعلّقة — فارغة دائماً لموظف ليس مديراً لأحد */
leaveRequestPortalRoutes.get("/inbox", async (req, res) => {
  res.json(await service.managerInbox(req.employeeAuth!.tenantId, req.employeeAuth!.employeeId));
});

leaveRequestPortalRoutes.post("/:id/approve", async (req, res) => {
  const request = await service.transitionLeaveRequest(req.employeeAuth!.tenantId, req.params.id, "approved", {
    approverEmployeeId: req.employeeAuth!.employeeId,
    isHrOverride: false,
  });
  res.json(request);
});

leaveRequestPortalRoutes.post("/:id/reject", async (req, res) => {
  const request = await service.transitionLeaveRequest(req.employeeAuth!.tenantId, req.params.id, "rejected", {
    approverEmployeeId: req.employeeAuth!.employeeId,
    isHrOverride: false,
  });
  res.json(request);
});
