-- تتبّع محاولات إعادة إرسال الفاتورة لزاتكا (يدوية أو تلقائية عبر jobs/زاتكا القادمة) لحساب فترة
-- الانتظار (backoff) قبل المحاولة التالية، بدل إعادة المحاولة على كل فاتورة كل نبضة بلا تمييز.
ALTER TABLE "SalesInvoice"
  ADD COLUMN "zatcaRetryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "zatcaLastAttemptAt" TIMESTAMP(3);
