-- الوظائف (المسمّيات الوظيفية) تصبح جدولاً حقيقياً لكل مستأجر، والمنصب يُبنى من وظيفة منها.
-- قبل هذا الترحيل كانت قائمة "الوظائف" في الإعدادات قائمة في ذاكرة المتصفح فقط (لا تُحفَظ)، ومسمّى الموظف نص حر.

CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_titles_tenantId_name_key" ON "job_titles"("tenantId", "name");

ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "positions" ADD COLUMN "jobTitleId" TEXT;

CREATE UNIQUE INDEX "positions_jobTitleId_key" ON "positions"("jobTitleId");

ALTER TABLE "positions" ADD CONSTRAINT "positions_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "job_titles"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- تعبئة أولية لكل مستأجر على حدة (بالمعرّف tenantId، لا بالاسم): اسم كل منصب قائم، وكل مسمّى وظيفي مكتوب فعلاً
-- في ملفات موظفيه (بعد إزالة المسافات الطرفية، ودون الفارغ). الاسم المكرر داخل المستأجر نفسه يُدرَج مرة واحدة.
INSERT INTO "job_titles" ("id", "tenantId", "name", "updatedAt")
SELECT gen_random_uuid()::text, src."tenantId", src."name", CURRENT_TIMESTAMP
FROM (
    SELECT "tenantId", btrim("name") AS "name" FROM "positions"
    UNION
    SELECT "tenantId", btrim("jobTitle") AS "name" FROM "employees" WHERE "jobTitle" IS NOT NULL
) AS src
WHERE src."name" <> '';

-- كل منصب قائم يُربَط بوظيفة اسمه داخل مستأجره نفسه، ويأخذ اسمها المنظَّف. لو تطابق منصبان بعد إزالة المسافات
-- (نادر: "محاسب" و"محاسب ")، يُربَط المطابق حرفياً أولاً (ثم الأقدم) ويبقى الآخر بلا وظيفة باسمه كما هو، فلا يُكسَر قيد التفرّد.
UPDATE "positions" AS p
SET "jobTitleId" = pick."jobTitleId", "name" = pick."name"
FROM (
    SELECT DISTINCT ON (jt."id") p2."id" AS "positionId", jt."id" AS "jobTitleId", jt."name"
    FROM "positions" AS p2
    JOIN "job_titles" AS jt ON jt."tenantId" = p2."tenantId" AND jt."name" = btrim(p2."name")
    ORDER BY jt."id", (p2."name" <> jt."name"), p2."createdAt", p2."id"
) AS pick
WHERE p."id" = pick."positionId";
