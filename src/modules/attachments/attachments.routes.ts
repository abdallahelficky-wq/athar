import { Router } from "express";
import { authenticate, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createAttachmentBodySchema } from "./attachments.schemas";
import { uploadSingleFile, listHandler, createHandler, deleteHandler } from "./attachments.controller";

export const attachmentRoutes = Router();
attachmentRoutes.use(authenticate, blockMutationsWhenReadOnly);

const canWrite = requireRole("admin", "finance_manager", "accountant", "hr_manager");

attachmentRoutes.get("/", listHandler);
attachmentRoutes.post("/", canWrite, uploadSingleFile, validateBody(createAttachmentBodySchema), createHandler);
attachmentRoutes.delete("/:id", canWrite, deleteHandler);
