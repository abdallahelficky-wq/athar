ALTER TABLE "purchase_invoice_lines"
ADD COLUMN "taxCategoryCode" "TaxCategoryCode" NOT NULL DEFAULT 'S',
ADD COLUMN "vatApplicable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "taxExemptionReasonCode" TEXT,
ADD COLUMN "taxExemptionReason" TEXT;
