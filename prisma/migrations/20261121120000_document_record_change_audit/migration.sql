-- سجل تعديلات المستندات والبيانات الأساسية — في قاعدة البيانات نفسها لا في مسار واحد من الكود، بنفس مبدأ
-- account_record_change (20260929120000): المُشغِّل يسجّل التغيير من أي مسار كان (الشاشة، الاستيراد، المرآة،
-- السكربتات)، والمنفّذ من إعداد المعاملة app.actor_user_id (setAuditActor)؛ بدونه يبقى فارغاً «غير مسجَّل».
-- audit_fill_actor (#111) يحفظ نسخة اسمه وبريده تلقائياً عند الإدراج في audit_logs.
--
-- الجداول: فواتير المبيعات والمشتريات، مردوداتهما، إشعارات المدين، السندات، العملاء، الموردون، الأصناف — وأسطر
-- المستندات (تُسجَّل على المستند الأب: entityType/entityId للأب، فيظهر تاريخ المستند كاملاً في مكان واحد).
-- الموظفون خارج هذه الدفعة عمداً: بياناتهم (راتب، هوية، آيبان) تخضع لإخفاء الموارد البشرية (lib/hrRedaction.ts)
-- وتحتاج قرار صلاحية عرض أولاً.
--
-- لكل صف: INSERT ⇒ <prefix>.created (بلا نسخة — الصف نفسه هو النسخة)؛ UPDATE ⇒ <prefix>.updated بالحقول التي تغيّرت
-- فعلاً (من/إلى) فقط؛ DELETE ⇒ <prefix>.deleted بنسخة الصف كاملة قبل الحذف. للأسطر: line_added / line_updated /
-- line_deleted بنسخة السطر. حقول السباكة لا تُسجَّل (updatedAt/createdAt وكل ما يبدأ بـ zatca وحقول التوقيع/الـQR) —
-- أرشيف زاتكا له سجل غير قابل للتعديل خاص به (zatca_append_only).
--
-- المرآة والعكس: الصف المنسوخ مرآةً إلى شركة أخرى إدراجٌ عادي في تلك الشركة، فيُسجَّل بـ tenantId/companyId الصف
-- نفسه (لا يحمل شيئاً من الأصل ولا يظهر في سجل الأصل). العكس ينشئ قيداً لا مستنداً؛ أي تعديل على المستند بسببه
-- يُسجَّل على المستند في شركته.

CREATE OR REPLACE FUNCTION record_row_change() RETURNS trigger AS $$
DECLARE
  entity_type TEXT := TG_ARGV[0];
  prefix TEXT := TG_ARGV[1];
  parent_col TEXT := NULLIF(TG_ARGV[2], '');
  parent_table TEXT := NULLIF(TG_ARGV[3], '');
  actor TEXT := NULLIF(current_setting('app.actor_user_id', true), '');
  old_row JSONB := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  new_row JSONB := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  row_now JSONB := COALESCE(new_row, old_row);
  tenant_id TEXT;
  company_id TEXT;
  entity_id TEXT;
  changes JSONB;
  act TEXT;
  meta JSONB;
BEGIN
  IF parent_col IS NULL THEN
    tenant_id := row_now->>'tenantId';
    company_id := row_now->>'companyId';
    entity_id := row_now->>'id';
  ELSE
    entity_id := row_now->>parent_col;
    EXECUTE format('SELECT "tenantId", "companyId" FROM %I WHERE "id" = $1', parent_table) INTO tenant_id, company_id USING entity_id;
    -- الأب محذوف (حذف متتالٍ CASCADE): حذفه مسجَّل بنفسه، ولا مستأجر نُسنِد إليه السطر.
    IF tenant_id IS NULL THEN RETURN NULL; END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(o.key, jsonb_build_object('from', o.value, 'to', n.value)) INTO changes
    FROM jsonb_each(old_row) o JOIN jsonb_each(new_row) n USING (key)
    WHERE o.value IS DISTINCT FROM n.value
      AND o.key NOT IN ('updatedAt', 'createdAt', 'qrPayload', 'invoiceHash', 'previousInvoiceHash', 'icv')
      AND o.key NOT LIKE 'zatca%';
    IF changes IS NULL THEN RETURN NULL; END IF;
    IF parent_col IS NULL THEN
      act := prefix || '.updated';
      meta := jsonb_build_object('provenance', 'recorded', 'changes', changes);
    ELSE
      act := prefix || '.line_updated';
      meta := jsonb_build_object('provenance', 'recorded', 'lineId', row_now->>'id', 'changes', changes);
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF parent_col IS NULL THEN
      act := prefix || '.created';
      meta := jsonb_build_object('provenance', 'recorded');
    ELSE
      act := prefix || '.line_added';
      meta := jsonb_build_object('provenance', 'recorded', 'lineId', row_now->>'id', 'after', new_row - 'createdAt' - 'updatedAt');
    END IF;
  ELSE
    IF parent_col IS NULL THEN
      act := prefix || '.deleted';
      meta := jsonb_build_object('provenance', 'recorded', 'before', old_row - 'qrPayload' - 'zatcaResponseRaw');
    ELSE
      act := prefix || '.line_deleted';
      meta := jsonb_build_object('provenance', 'recorded', 'lineId', row_now->>'id', 'before', old_row);
    END IF;
  END IF;

  INSERT INTO "audit_logs" ("id", "tenantId", "companyId", "userId", "action", "entityType", "entityId", "metadata")
  VALUES ('rrc_' || gen_random_uuid()::text, tenant_id, company_id, actor, act, entity_type, entity_id, meta);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- المستندات
CREATE TRIGGER sales_invoices_record_change AFTER INSERT OR UPDATE OR DELETE ON "sales_invoices"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('SalesInvoice', 'sales_invoice');
CREATE TRIGGER sales_invoice_lines_record_change AFTER INSERT OR UPDATE OR DELETE ON "sales_invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('SalesInvoice', 'sales_invoice', 'invoiceId', 'sales_invoices');

CREATE TRIGGER purchase_invoices_record_change AFTER INSERT OR UPDATE OR DELETE ON "purchase_invoices"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('PurchaseInvoice', 'purchase_invoice');
CREATE TRIGGER purchase_invoice_lines_record_change AFTER INSERT OR UPDATE OR DELETE ON "purchase_invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('PurchaseInvoice', 'purchase_invoice', 'invoiceId', 'purchase_invoices');

CREATE TRIGGER sales_returns_record_change AFTER INSERT OR UPDATE OR DELETE ON "sales_returns"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('SalesReturn', 'sales_return');
CREATE TRIGGER sales_return_lines_record_change AFTER INSERT OR UPDATE OR DELETE ON "sales_return_lines"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('SalesReturn', 'sales_return', 'returnId', 'sales_returns');

CREATE TRIGGER purchase_returns_record_change AFTER INSERT OR UPDATE OR DELETE ON "purchase_returns"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('PurchaseReturn', 'purchase_return');
CREATE TRIGGER purchase_return_lines_record_change AFTER INSERT OR UPDATE OR DELETE ON "purchase_return_lines"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('PurchaseReturn', 'purchase_return', 'returnId', 'purchase_returns');

CREATE TRIGGER sales_debit_notes_record_change AFTER INSERT OR UPDATE OR DELETE ON "sales_debit_notes"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('SalesDebitNote', 'sales_debit_note');
CREATE TRIGGER sales_debit_note_lines_record_change AFTER INSERT OR UPDATE OR DELETE ON "sales_debit_note_lines"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('SalesDebitNote', 'sales_debit_note', 'debitNoteId', 'sales_debit_notes');

CREATE TRIGGER receipts_record_change AFTER INSERT OR UPDATE OR DELETE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('Receipt', 'receipt');

-- البيانات الأساسية
CREATE TRIGGER customers_record_change AFTER INSERT OR UPDATE OR DELETE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('Customer', 'customer');
CREATE TRIGGER suppliers_record_change AFTER INSERT OR UPDATE OR DELETE ON "suppliers"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('Supplier', 'supplier');
CREATE TRIGGER items_record_change AFTER INSERT OR UPDATE OR DELETE ON "items"
  FOR EACH ROW EXECUTE FUNCTION record_row_change('Item', 'item');
