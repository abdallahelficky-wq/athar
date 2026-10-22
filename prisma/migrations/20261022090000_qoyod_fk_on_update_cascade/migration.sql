-- يطابق مفاتيح Qoyod الأجنبية الثلاثة مع ما يتوقعه Prisma — إصلاح فرق مخطط سابق (drift) أدخله 20261015081500_qoyod_journal_outbox:
-- أُنشئت المفاتيح هناك داخل CREATE TABLE بلا ON UPDATE، فبقي الافتراضي NO ACTION، بينما علاقات Prisma (schema.prisma: QoyodConnection،
-- QoyodJournalExport) تتوقع ON UPDATE CASCADE كبقية المخطط. الترحيل المدموج لا يُعدَّل؛ هذا يعيد إنشاء القيود الثلاثة بالأسماء نفسها
-- و ON DELETE RESTRICT نفسه، والفرق الوحيد ON UPDATE CASCADE. تعريف قيود فقط: لا تغيير في أي بيانات، ولا يمسّ مشغّلات Qoyod
-- (الحراسة على القيود المصدَّرة). النص مطابق لما يولّده `prisma migrate diff` على قاعدة مُرحَّلة للتو.

-- DropForeignKey
ALTER TABLE "qoyod_connections" DROP CONSTRAINT "qoyod_connections_id_fkey";

-- DropForeignKey
ALTER TABLE "qoyod_journal_exports" DROP CONSTRAINT "qoyod_journal_exports_companyId_fkey";

-- DropForeignKey
ALTER TABLE "qoyod_journal_exports" DROP CONSTRAINT "qoyod_journal_exports_id_fkey";

-- AddForeignKey
ALTER TABLE "qoyod_connections" ADD CONSTRAINT "qoyod_connections_id_fkey" FOREIGN KEY ("id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qoyod_journal_exports" ADD CONSTRAINT "qoyod_journal_exports_id_fkey" FOREIGN KEY ("id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qoyod_journal_exports" ADD CONSTRAINT "qoyod_journal_exports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "qoyod_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
