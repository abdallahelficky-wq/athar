import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as c from "./stables.controller";
import * as s from "./stables.schemas";

export const stableRoutes = Router();
stableRoutes.use(authenticate);
const edit = requireRole("admin", "finance_manager");
stableRoutes.get("/overview", c.overview);
stableRoutes.get("/", c.listStables); stableRoutes.post("/", edit, validateBody(s.createStableSchema), c.createStable);
stableRoutes.patch("/:id", edit, validateBody(s.updateStableSchema), c.updateStable); stableRoutes.delete("/:id", edit, c.deleteStable);
stableRoutes.get("/stalls/list", c.listStalls); stableRoutes.post("/stalls", edit, validateBody(s.createStallSchema), c.createStall);
stableRoutes.patch("/stalls/:id", edit, validateBody(s.updateStallSchema), c.updateStall); stableRoutes.delete("/stalls/:id", edit, c.deleteStall);
stableRoutes.get("/horses/list", c.listHorses); stableRoutes.post("/horses", edit, validateBody(s.createHorseSchema), c.createHorse);
stableRoutes.patch("/horses/:id", edit, validateBody(s.updateHorseSchema), c.updateHorse); stableRoutes.delete("/horses/:id", edit, c.deleteHorse);
stableRoutes.get("/contracts/list", c.listContracts); stableRoutes.post("/contracts", edit, validateBody(s.createContractSchema), c.createContract);
stableRoutes.get("/contracts/:id/pdf", c.downloadContractPdf); stableRoutes.post("/contracts/:id/send-email", edit, validateBody(s.sendContractEmailSchema), c.emailContract);
stableRoutes.patch("/contracts/:id", edit, validateBody(s.updateContractSchema), c.updateContract); stableRoutes.delete("/contracts/:id", edit, c.deleteContract);
stableRoutes.get("/care/list", c.listCare); stableRoutes.post("/care", edit, validateBody(s.createCareRecordSchema), c.createCare);
stableRoutes.patch("/care/:id", edit, validateBody(s.updateCareRecordSchema), c.updateCare); stableRoutes.delete("/care/:id", edit, c.deleteCare);

