-- ترحيل مسودة الإجازة السنوية: حالة المسودة وروابط القيد والتسوية الناتجين، وحسابات الترحيل الافتراضية في إعدادات الرواتب.
ALTER TABLE "annual_leave_drafts" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "annual_leave_drafts" ADD COLUMN "journalEntryId" TEXT;
ALTER TABLE "annual_leave_drafts" ADD COLUMN "leaveSettlementId" TEXT;
ALTER TABLE "annual_leave_drafts" ADD COLUMN "postedBy" TEXT;
ALTER TABLE "annual_leave_drafts" ADD COLUMN "postedAt" TIMESTAMP(3);

ALTER TABLE "payroll_settings" ADD COLUMN "leaveExpenseAccountId" TEXT;
ALTER TABLE "payroll_settings" ADD COLUMN "leaveAdditionsAccountId" TEXT;
ALTER TABLE "payroll_settings" ADD COLUMN "leaveTicketAccountId" TEXT;
