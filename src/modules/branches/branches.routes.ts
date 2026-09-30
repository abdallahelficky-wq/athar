import { requirePositionAction } from "../../middleware/positionMatrix";
import { Router } from "express";
import { authenticate, enforceCompanyScope, requireRole, blockMutationsWhenReadOnly } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createBranchSchema, updateBranchSchema } from "./branches.schemas";
import { listBranches, createBranch, updateBranch, deleteBranch } from "./branches.controller";

export const branchRoutes = Router();
branchRoutes.use(authenticate, enforceCompanyScope, blockMutationsWhenReadOnly);

branchRoutes.get("/", requirePositionAction("branches", "read"), listBranches);
branchRoutes.post("/", requirePositionAction("branches", "create"), requireRole("admin", "finance_manager"), validateBody(createBranchSchema), createBranch);
branchRoutes.patch("/:id", requirePositionAction("branches", "edit"), requireRole("admin", "finance_manager"), validateBody(updateBranchSchema), updateBranch);
branchRoutes.delete("/:id", requirePositionAction("branches", "delete"), requireRole("admin", "finance_manager"), deleteBranch);
