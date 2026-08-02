import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createWarehouseSchema, updateWarehouseSchema } from "./warehouses.schemas";
import { listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse } from "./warehouses.controller";

export const warehouseRoutes = Router();
warehouseRoutes.use(authenticate);

warehouseRoutes.get("/", listWarehouses);
warehouseRoutes.post("/", requireRole("admin", "finance_manager"), validateBody(createWarehouseSchema), createWarehouse);
warehouseRoutes.patch("/:id", requireRole("admin", "finance_manager"), validateBody(updateWarehouseSchema), updateWarehouse);
warehouseRoutes.delete("/:id", requireRole("admin", "finance_manager"), deleteWarehouse);
