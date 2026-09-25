-- AlterTable
ALTER TABLE "company_zatca_credentials" ADD COLUMN "lastMissingComplianceSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "lastComplianceStepsCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "zatca_compliance_step_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "complianceRequestId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subtype" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentUuid" TEXT NOT NULL,
    "icv" INTEGER NOT NULL,
    "previousInvoiceHash" TEXT NOT NULL,
    "invoiceHash" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "rejectionReason" TEXT,
    "zatcaResponseRaw" JSONB,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zatca_compliance_step_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zatca_compliance_step_attempts_companyId_complianceRequestI_key" ON "zatca_compliance_step_attempts"("companyId", "complianceRequestId", "stepKey");

-- AddForeignKey
ALTER TABLE "zatca_compliance_step_attempts" ADD CONSTRAINT "zatca_compliance_step_attempts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zatca_compliance_step_attempts" ADD CONSTRAINT "zatca_compliance_step_attempts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
