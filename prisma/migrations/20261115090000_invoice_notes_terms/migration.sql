-- ملاحظات والشروط والأحكام على فاتورة المبيعات، وشروط افتراضية لكل شركة. أعمدة اختيارية بلا قيم افتراضية:
-- لا تغيير لأي فاتورة أو شركة قائمة.
ALTER TABLE "sales_invoices" ADD COLUMN "notes" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN "termsAndConditions" TEXT;
ALTER TABLE "companies" ADD COLUMN "defaultInvoiceTerms" TEXT;
