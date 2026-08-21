import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createBranchSchema, updateBranchSchema } from "./branches.schemas";
import { listBranches, createBranch, updateBranch, deleteBranch } from "./branches.controller";

export const branchRoutes = Router();
branchRoutes.use(authenticate);

branchRoutes.get("/", listBranches);
branchRoutes.post("/", requireRole("admin", "finance_manager"), validateBody(createBranchSchema), createBranch);
branchRoutes.patch("/:id", requireRole("admin", "finance_manager"), validateBody(updateBranchSchema), updateBranch);
branchRoutes.delete("/:id", requireRole("admin", "finance_manager"), deleteBranch);
