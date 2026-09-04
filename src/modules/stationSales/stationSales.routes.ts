import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createStationSaleSchema } from "./stationSales.schemas";
import { listHandler, createHandler, deleteHandler } from "./stationSales.controller";

export const stationSaleRoutes = Router();
stationSaleRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

stationSaleRoutes.get("/", listHandler);
stationSaleRoutes.post("/", canWrite, validateBody(createStationSaleSchema), createHandler);
stationSaleRoutes.delete("/:id", canWrite, deleteHandler);
