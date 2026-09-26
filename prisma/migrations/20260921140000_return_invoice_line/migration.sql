ALTER TABLE "sales_return_lines" ADD COLUMN "originalInvoiceLineId" TEXT;
CREATE INDEX "sales_returns_tenant_related_invoice_idx" ON "sales_returns" ("tenantId", "relatedInvoiceId");
