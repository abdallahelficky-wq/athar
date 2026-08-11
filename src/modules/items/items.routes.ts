import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createItemSchema, updateItemSchema, setComponentsSchema } from "./items.schemas";
import { listItems, getItem, getItemByBarcode, createItem, updateItem, deleteItem, getItemComponents, setItemComponents } from "./items.controller";

export const itemRoutes = Router();
itemRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "accountant");

itemRoutes.get("/", listItems);
// قبل "/:id" عمداً — وإلا لالتُقطت "by-barcode" كقيمة لباراميتر :id
itemRoutes.get("/by-barcode", getItemByBarcode);
itemRoutes.get("/:id", getItem);
itemRoutes.post("/", canWrite, validateBody(createItemSchema), createItem);
itemRoutes.patch("/:id", canWrite, validateBody(updateItemSchema), updateItem);
itemRoutes.delete("/:id", canWrite, deleteItem);

itemRoutes.get("/:id/components", getItemComponents);
itemRoutes.put("/:id/components", canWrite, validateBody(setComponentsSchema), setItemComponents);
