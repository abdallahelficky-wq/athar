import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
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
customerRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "accountant");

customerRoutes.get("/", listCustomers);
customerRoutes.get("/:id/balance", getCustomerBalance);
customerRoutes.post("/", canWrite, validateBody(createCustomerSchema), createCustomer);
customerRoutes.patch("/:id", canWrite, validateBody(updateCustomerSchema), updateCustomer);
customerRoutes.delete("/:id", canWrite, deleteCustomer);
customerRoutes.post(
  "/:id/extract-document",
  canWrite,
  uploadSingleFile,
  validateBody(extractCustomerDocumentSchema),
  extractCustomerDocument,
);
