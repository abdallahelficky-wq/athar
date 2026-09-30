import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createStationSaleSchema } from "./stationSales.schemas";
import { listHandler, createHandler, deleteHandler } from "./stationSales.controller";

export const stationSaleRoutes = Router();
stationSaleRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

stationSaleRoutes.get("/", requirePositionAction("stationSales", "read"), listHandler);
stationSaleRoutes.post("/", requirePositionAction("stationSales", "create"), canWrite, validateBody(createStationSaleSchema), createHandler);
stationSaleRoutes.delete("/:id", requirePositionAction("stationSales", "delete"), canWrite, deleteHandler);
