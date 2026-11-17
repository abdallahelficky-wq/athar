-- ربط طلب المتجر بفاتورة المبيعات الصادرة منه (فاتورة واحدة للطلب؛ حذف المسودة يفكّ الربط).
ALTER TABLE "store_orders" ADD COLUMN "salesInvoiceId" TEXT;
CREATE UNIQUE INDEX "store_orders_salesInvoiceId_key" ON "store_orders"("salesInvoiceId");
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
