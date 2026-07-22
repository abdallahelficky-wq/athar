import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCustomerSchema, updateCustomerSchema } from "./customers.schemas";
import {
  listCustomers,
  getCustomerBalance,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "./customers.controller";

export const customerRoutes = Router();
customerRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "accountant");

customerRoutes.get("/", listCustomers);
customerRoutes.get("/:id/balance", getCustomerBalance);
customerRoutes.post("/", canWrite, validateBody(createCustomerSchema), createCustomer);
customerRoutes.patch("/:id", canWrite, validateBody(updateCustomerSchema), updateCustomer);
customerRoutes.delete("/:id", canWrite, deleteCustomer);
