-- تعبئة من الاسم الصريح فقط (نفس OTHER_INCOME_NAME في src/lib/accountClassification.ts)، لحسابات الإيراد بلا دور.
-- القيمة تُورَّث للأبناء: تصنيف مجموعة "إيرادات ومصروفات أخرى" يكفي لكل ما تحتها (عدا ما له دور خاص به كتكاليف التمويل).
-- التعبئة تصنيف نظامي لا تعديل مستخدم: لا تُسجَّل في سجل التدقيق.
ALTER TABLE "accounts" DISABLE TRIGGER "accounts_record_change";

UPDATE "accounts" SET "analysisRole" = 'other_income'
WHERE "analysisRole" IS NULL AND "type" = 'revenue'
  AND "name" ~ '(إيرادات أخرى|ايرادات أخرى|إيرادات اخرى|ايرادات اخرى|ومصروفات أخرى|ومصروفات اخرى|غير تشغيلي|غير التشغيلي|فروق(ات)? (ال)?عمل|فروق(ات)? (ال)?صرف|أرباح ?/ ?خسائر|أرباح وخسائر|استبعاد|(إيراد|ايراد)(ات)? (ال)?فوائد)';

ALTER TABLE "accounts" ENABLE TRIGGER "accounts_record_change";
