import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createItemSchema, updateItemSchema, setComponentsSchema } from "./items.schemas";
import { listItems, getItem, getItemByBarcode, createItem, updateItem, deleteItem, getItemComponents, setItemComponents } from "./items.controller";

export const itemRoutes = Router();
itemRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant");

itemRoutes.get("/", requirePositionAction("items", "read"), listItems);
// قبل "/:id" عمداً — وإلا لالتُقطت "by-barcode" كقيمة لباراميتر :id
itemRoutes.get("/by-barcode", requirePositionAction("items", "read"), getItemByBarcode);
itemRoutes.get("/:id", requirePositionAction("items", "read"), getItem);
itemRoutes.post("/", requirePositionAction("items", "create"), canWrite, validateBody(createItemSchema), createItem);
itemRoutes.patch("/:id", requirePositionAction("items", "edit"), canWrite, validateBody(updateItemSchema), updateItem);
itemRoutes.delete("/:id", requirePositionAction("items", "delete"), canWrite, deleteItem);

itemRoutes.get("/:id/components", requirePositionAction("items", "read"), getItemComponents);
itemRoutes.put("/:id/components", requirePositionAction("items", "edit"), canWrite, validateBody(setComponentsSchema), setItemComponents);
