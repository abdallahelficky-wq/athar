import { Router } from "express";
import { authenticateEmployeePortal } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { employeePortalLoginSchema } from "./employeePortal.schemas";
import { login, me } from "./employeePortal.controller";

export const employeePortalRoutes = Router();

employeePortalRoutes.post("/login", validateBody(employeePortalLoginSchema), login);
employeePortalRoutes.get("/me", authenticateEmployeePortal, me);
