import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createWarehouseSchema, updateWarehouseSchema } from "./warehouses.schemas";
import { listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse } from "./warehouses.controller";

export const warehouseRoutes = Router();
warehouseRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

warehouseRoutes.get("/", requirePositionAction("warehouses", "read"), listWarehouses);
warehouseRoutes.post("/", requirePositionAction("warehouses", "create"), requireRole("admin", "finance_manager"), validateBody(createWarehouseSchema), createWarehouse);
warehouseRoutes.patch("/:id", requirePositionAction("warehouses", "edit"), requireRole("admin", "finance_manager"), validateBody(updateWarehouseSchema), updateWarehouse);
warehouseRoutes.delete("/:id", requirePositionAction("warehouses", "delete"), requireRole("admin", "finance_manager"), deleteWarehouse);
