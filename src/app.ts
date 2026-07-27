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
import { customerRoutes } from "./modules/customers/customers.routes";
import { sellableItemRoutes } from "./modules/sellableItems/sellableItems.routes";
import { quotationRoutes } from "./modules/quotations/quotations.routes";
import { salesInvoiceRoutes } from "./modules/salesInvoices/salesInvoices.routes";
import { salesReturnRoutes } from "./modules/salesReturns/salesReturns.routes";
import { receiptRoutes } from "./modules/receipts/receipts.routes";
import { stationSaleRoutes } from "./modules/stationSales/stationSales.routes";
import { salesReportRoutes } from "./modules/salesReports/salesReports.routes";
import { supplierRoutes } from "./modules/suppliers/suppliers.routes";
import { purchaseInvoiceRoutes } from "./modules/purchaseInvoices/purchaseInvoices.routes";
import { purchaseReturnRoutes } from "./modules/purchaseReturns/purchaseReturns.routes";
import { purchaseReportRoutes } from "./modules/purchaseReports/purchaseReports.routes";
import { itemRoutes } from "./modules/items/items.routes";
import { stockMovementRoutes } from "./modules/stockMovements/stockMovements.routes";
import { inventoryReportRoutes } from "./modules/inventoryReports/inventoryReports.routes";
import { fixedAssetRoutes } from "./modules/fixedAssets/fixedAssets.routes";
import { depreciationRunRoutes } from "./modules/depreciation/depreciation.routes";
import { employeeRoutes } from "./modules/employees/employees.routes";
import { leaveRequestRoutes } from "./modules/leaveRequests/leaveRequests.routes";
import { hrActionRoutes } from "./modules/hrActions/hrActions.routes";
import { payrollRunRoutes } from "./modules/payrollRuns/payrollRuns.routes";
import { leaveSettlementRoutes } from "./modules/leaveSettlements/leaveSettlements.routes";
import { leaveReturnRoutes } from "./modules/leaveReturns/leaveReturns.routes";
import { hrReportRoutes } from "./modules/hrReports/hrReports.routes";
import { attachmentRoutes } from "./modules/attachments/attachments.routes";
import { leaseContractRoutes } from "./modules/leaseContracts/leaseContracts.routes";
import { companyDocumentRoutes } from "./modules/companyDocuments/companyDocuments.routes";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes";

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
  app.use("/api/customers", customerRoutes);
  app.use("/api/sellable-items", sellableItemRoutes);
  app.use("/api/quotations", quotationRoutes);
  app.use("/api/sales-invoices", salesInvoiceRoutes);
  app.use("/api/sales-returns", salesReturnRoutes);
  app.use("/api/receipts", receiptRoutes);
  app.use("/api/station-sales", stationSaleRoutes);
  app.use("/api/sales-reports", salesReportRoutes);
  app.use("/api/suppliers", supplierRoutes);
  app.use("/api/purchase-invoices", purchaseInvoiceRoutes);
  app.use("/api/purchase-returns", purchaseReturnRoutes);
  app.use("/api/purchase-reports", purchaseReportRoutes);
  app.use("/api/items", itemRoutes);
  app.use("/api/stock-movements", stockMovementRoutes);
  app.use("/api/inventory-reports", inventoryReportRoutes);
  app.use("/api/fixed-assets", fixedAssetRoutes);
  app.use("/api/depreciation-runs", depreciationRunRoutes);
  app.use("/api/employees", employeeRoutes);
  app.use("/api/leave-requests", leaveRequestRoutes);
  app.use("/api/hr-actions", hrActionRoutes);
  app.use("/api/payroll-runs", payrollRunRoutes);
  app.use("/api/leave-settlements", leaveSettlementRoutes);
  app.use("/api/leave-returns", leaveReturnRoutes);
  app.use("/api/hr-reports", hrReportRoutes);
  app.use("/api/attachments", attachmentRoutes);
  app.use("/api/lease-contracts", leaseContractRoutes);
  app.use("/api/company-documents", companyDocumentRoutes);
  app.use("/api/dashboard", dashboardRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: `المسار غير موجود: ${req.method} ${req.path}` });
  });

  app.use(errorHandler);

  return app;
}
