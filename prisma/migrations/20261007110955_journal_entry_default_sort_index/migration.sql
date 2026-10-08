-- CreateIndex
-- الترتيب الافتراضي لقوائم القيود: آخر ما أُدخل أولاً (entrySeq DESC NULLS LAST, createdAt DESC, id DESC).
-- NULLS LAST مضاف يدوياً على SQL الذي ولّده `prisma migrate dev`: Prisma لا يعبّر عن موضع القيم الفارغة، وDESC وحده في
-- Postgres يعني NULLS FIRST، فلا يخدم الفهرس ترتيب الاستعلام (قيود قديمة بلا entrySeq تأتي آخراً). Prisma لا يرى فرقاً
-- (migrate diff فارغ)، فلا انجراف في المخطط.
CREATE INDEX "journal_entries_tenantId_companyId_entrySeq_createdAt_id_idx" ON "journal_entries"("tenantId", "companyId", "entrySeq" DESC NULLS LAST, "createdAt" DESC, "id" DESC);
