import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/errorHandler";
import { authRoutes } from "./modules/auth/auth.routes";
import { companyRoutes } from "./modules/companies/companies.routes";
import { accountRoutes } from "./modules/accounts/accounts.routes";
import { costCenterRoutes } from "./modules/costCenters/costCenters.routes";
import { journalEntryRoutes } from "./modules/journalEntries/journalEntries.routes";
import { reportRoutes } from "./modules/reports/reports.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/companies", companyRoutes);
  app.use("/api/accounts", accountRoutes);
  app.use("/api/cost-centers", costCenterRoutes);
  app.use("/api/journal-entries", journalEntryRoutes);
  app.use("/api/reports", reportRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `المسار غير موجود: ${req.method} ${req.path}` });
  });

  app.use(errorHandler);

  return app;
}
