ALTER TABLE "items" ADD COLUMN "nameEn" TEXT,
ADD COLUMN "taxCategoryCode" "TaxCategoryCode",
ADD COLUMN "taxExemptionReasonCode" TEXT,
ADD COLUMN "taxExemptionReason" TEXT,
ADD COLUMN "priceIncludesVat" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "sales_invoice_lines" ADD COLUMN "taxExemptionReasonCode" TEXT;
ALTER TABLE "sales_return_lines" ADD COLUMN "taxExemptionReasonCode" TEXT;
