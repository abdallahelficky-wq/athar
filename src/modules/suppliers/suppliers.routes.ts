import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole } from "../../middleware/auth";
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
supplierRoutes.use(authenticate, enforceCompanyScope);

const canWrite = requireRole("admin", "finance_manager", "accountant");

supplierRoutes.get("/", listSuppliers);
supplierRoutes.get("/:id/balance", getSupplierBalance);
supplierRoutes.post("/", canWrite, validateBody(createSupplierSchema), createSupplier);
supplierRoutes.patch("/:id", canWrite, validateBody(updateSupplierSchema), updateSupplier);
supplierRoutes.delete("/:id", canWrite, deleteSupplier);
