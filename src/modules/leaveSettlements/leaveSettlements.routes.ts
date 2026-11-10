import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly, requireHrRead } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaveSettlementSchema, disburseSchema } from "./leaveSettlements.schemas";
import { listHandler, previewHandler, createHandler, disburseHandler } from "./leaveSettlements.controller";
import { assertCompanyAccess } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../lib/httpError";
import { annualLeaveDraftSchema } from "./annualLeaveDraft.schemas";
import { previewAnnualLeave, saveAnnualLeaveDraft, updateAnnualLeaveDraft, deleteAnnualLeaveDraft } from "./annualLeaveDraft.service";

export const leaveSettlementRoutes = Router();
leaveSettlementRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "hr_manager");

leaveSettlementRoutes.post("/annual-preview", requirePositionAction("leaveSettlements", "read"), requireHrRead,
  validateBody(annualLeaveDraftSchema), async (req, res) => {
    assertCompanyAccess(req.auth!, req.body.companyId);
    res.json(await previewAnnualLeave(req.auth!.tenantId, req.body));
  });
leaveSettlementRoutes.post("/annual-drafts", requirePositionAction("leaveSettlements", "create"), canWrite,
  validateBody(annualLeaveDraftSchema), async (req, res) => {
    assertCompanyAccess(req.auth!, req.body.companyId);
    res.status(201).json(await saveAnnualLeaveDraft(req.auth!.tenantId, req.auth!.sub, req.body));
  });
leaveSettlementRoutes.put("/annual-drafts/:id", requirePositionAction("leaveSettlements", "edit"), canWrite,
  validateBody(annualLeaveDraftSchema), async (req, res) => {
    assertCompanyAccess(req.auth!, req.body.companyId);
    res.json(await updateAnnualLeaveDraft(req.auth!.tenantId, req.params.id, req.body));
  });
leaveSettlementRoutes.delete("/annual-drafts/:id", requirePositionAction("leaveSettlements", "delete"), canWrite, async (req, res) => {
  const draft = await prisma.annualLeaveDraft.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId }, select: { companyId: true } });
  if (draft) assertCompanyAccess(req.auth!, draft.companyId);
  res.json(await deleteAnnualLeaveDraft(req.auth!.tenantId, req.params.id));
});
leaveSettlementRoutes.get("/annual-drafts", requirePositionAction("leaveSettlements", "read"), requireHrRead, async (req, res) => {
  if (typeof req.query.companyId !== "string") throw badRequest("companyId is required");
  assertCompanyAccess(req.auth!, req.query.companyId);
  res.json(await prisma.annualLeaveDraft.findMany({ where: { tenantId: req.auth!.tenantId, companyId: req.query.companyId }, orderBy: { createdAt: "desc" }, take: 100 }));
});

leaveSettlementRoutes.get("/", requirePositionAction("leaveSettlements", "read"), requireHrRead, listHandler);
leaveSettlementRoutes.get("/preview", requirePositionAction("leaveSettlements", "read"), requireHrRead, previewHandler);
leaveSettlementRoutes.post("/", requirePositionAction("leaveSettlements", "create"), canWrite, validateBody(createLeaveSettlementSchema), createHandler);
leaveSettlementRoutes.post("/:id/disburse", requirePositionAction("leaveSettlements", "approve"), canWrite, validateBody(disburseSchema), disburseHandler);
