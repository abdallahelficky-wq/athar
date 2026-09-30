import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCustomerSchema, updateCustomerSchema, extractCustomerDocumentSchema } from "./customers.schemas";
import {
  listCustomers,
  getCustomerBalance,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  extractCustomerDocument,
} from "./customers.controller";
import { uploadSingleFile } from "../attachments/attachments.controller";

export const customerRoutes = Router();
customerRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

customerRoutes.get("/", requirePositionAction("customers", "read"), listCustomers);
customerRoutes.get("/:id/balance", requirePositionAction("customers", "read"), getCustomerBalance);
customerRoutes.post("/", requirePositionAction("customers", "create"), canWrite, validateBody(createCustomerSchema), createCustomer);
customerRoutes.patch("/:id", requirePositionAction("customers", "edit"), canWrite, validateBody(updateCustomerSchema), updateCustomer);
customerRoutes.delete("/:id", requirePositionAction("customers", "delete"), canWrite, deleteCustomer);
customerRoutes.post(
  "/:id/extract-document", requirePositionAction("customers", "create"),
  canWrite,
  uploadSingleFile,
  validateBody(extractCustomerDocumentSchema),
  extractCustomerDocument,
);
