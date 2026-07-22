import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createItemSchema, updateItemSchema } from "./items.schemas";
import { listItems, createItem, updateItem, deleteItem } from "./items.controller";

export const itemRoutes = Router();
itemRoutes.use(authenticate);

const canWrite = requireRole("admin", "finance_manager", "accountant");

itemRoutes.get("/", listItems);
itemRoutes.post("/", canWrite, validateBody(createItemSchema), createItem);
itemRoutes.patch("/:id", canWrite, validateBody(updateItemSchema), updateItem);
itemRoutes.delete("/:id", canWrite, deleteItem);
