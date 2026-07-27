import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createLeaseContractSchema, updateLeaseContractSchema } from "./leaseContracts.schemas";
import {
  listLeaseContracts,
  createLeaseContract,
  updateLeaseContract,
  deleteLeaseContract,
} from "./leaseContracts.controller";

export const leaseContractRoutes = Router();
leaseContractRoutes.use(authenticate);

leaseContractRoutes.get("/", listLeaseContracts);
leaseContractRoutes.post(
  "/",
  requireRole("admin", "finance_manager"),
  validateBody(createLeaseContractSchema),
  createLeaseContract,
);
leaseContractRoutes.patch(
  "/:id",
  requireRole("admin", "finance_manager"),
  validateBody(updateLeaseContractSchema),
  updateLeaseContract,
);
leaseContractRoutes.delete("/:id", requireRole("admin", "finance_manager"), deleteLeaseContract);
