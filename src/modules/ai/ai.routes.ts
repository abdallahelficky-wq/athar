import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { askAiHandler } from "./ai.controller";

export const aiRoutes = Router();
aiRoutes.use(authenticate);
aiRoutes.post("/ask", askAiHandler);
