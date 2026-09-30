import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createSupplierSchema, updateSupplierSchema } from "./suppliers.schemas";
import {
  listSuppliers,
  getSupplierBalance,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from "./suppliers.controller";

export const supplierRoutes = Router();
supplierRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

supplierRoutes.get("/", requirePositionAction("suppliers", "read"), listSuppliers);
supplierRoutes.get("/:id/balance", requirePositionAction("suppliers", "read"), getSupplierBalance);
supplierRoutes.post("/", requirePositionAction("suppliers", "create"), canWrite, validateBody(createSupplierSchema), createSupplier);
supplierRoutes.patch("/:id", requirePositionAction("suppliers", "edit"), canWrite, validateBody(updateSupplierSchema), updateSupplier);
supplierRoutes.delete("/:id", requirePositionAction("suppliers", "delete"), canWrite, deleteSupplier);
