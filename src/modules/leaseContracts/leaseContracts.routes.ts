import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaseContractSchema, updateLeaseContractSchema } from "./leaseContracts.schemas";
import {
  listLeaseContracts,
  createLeaseContract,
  updateLeaseContract,
  deleteLeaseContract,
} from "./leaseContracts.controller";

export const leaseContractRoutes = Router();
leaseContractRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

leaseContractRoutes.get("/", requirePositionAction("leaseContracts", "read"), listLeaseContracts);
leaseContractRoutes.post(
  "/", requirePositionAction("leaseContracts", "create"),
  requireRole("admin", "finance_manager"),
  validateBody(createLeaseContractSchema),
  createLeaseContract,
);
leaseContractRoutes.patch(
  "/:id", requirePositionAction("leaseContracts", "edit"),
  requireRole("admin", "finance_manager"),
  validateBody(updateLeaseContractSchema),
  updateLeaseContract,
);
leaseContractRoutes.delete("/:id", requirePositionAction("leaseContracts", "delete"), requireRole("admin", "finance_manager"), deleteLeaseContract);
