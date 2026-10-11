BEGIN;
CREATE TEMP TABLE separation_targets(company_id text PRIMARY KEY, tenant_id text UNIQUE, admin_id text UNIQUE);
CREATE TEMP TABLE separation_ownership(table_name text, row_id text, company_id text, PRIMARY KEY(table_name,row_id,company_id));
COMMIT;
BEGIN READ ONLY;
-- Read-only technical ownership check. Only IDs and relationship counts; no financial/document contents.

INSERT INTO separation_targets VALUES
 ('cmuhc8l5t00f4qjb6uoe4vxx8','split_'||md5('cmuhc8l5t00f4qjb6uoe4vxx8'),'split_'||md5('admin:cmuhc8l5t00f4qjb6uoe4vxx8')),
 ('cmuttoi4d000cd4o74anj3ibr','split_'||md5('cmuttoi4d000cd4o74anj3ibr'),'split_'||md5('admin:cmuttoi4d000cd4o74anj3ibr'));
DO $separate$
DECLARE
 source_id constant text := 'cmsrchwg90009e8f5fmj3v59l';
 retained_company constant text := 'cmsrciyjv000ge8f57p2azqdd';
 owner_id text;
 rec record; target record; obj record; changed int; added int; invalid boolean;
 table_id text; type_name text;
 ignored text[] := ARRAY['tenants','users','identities','refresh_tokens','password_reset_tokens','positions','job_titles','position_permissions','position_action_permissions','user_action_permission_overrides','platform_notices'];
BEGIN

 SELECT u.id INTO STRICT owner_id FROM users u JOIN identities i ON i.id=u."identityId"
 WHERE u."tenantId"=source_id AND lower(i.email)='asf@tismpro.sa' AND u.active
 AND u."deletedAt" IS NULL AND u."inviteStatus"='accepted' AND u.role='admin' AND u."companyScope"='all';
 IF (SELECT count(*) FROM companies WHERE "tenantId"=source_id)<>3
 OR (SELECT count(*) FROM companies WHERE "tenantId"=source_id AND (id=retained_company OR id IN (SELECT company_id FROM separation_targets)))<>3 THEN
   RAISE EXCEPTION 'Unexpected company set; no changes applied';
 END IF;
 IF EXISTS(SELECT 1 FROM users WHERE "tenantId"=source_id AND id<>owner_id AND "companyScope" NOT IN (SELECT id FROM companies WHERE "tenantId"=source_id)) THEN
   RAISE EXCEPTION 'Unresolved shared membership';
 END IF;
 IF EXISTS(SELECT 1 FROM accounts WHERE "tenantId"=source_id AND "intercompanyCompanyId" IS NOT NULL)
 OR EXISTS(SELECT 1 FROM journal_entries WHERE "tenantId"=source_id AND "mirrorEntryId" IS NOT NULL) THEN
   RAISE EXCEPTION 'Intercompany or mirror links require separate review';
 END IF;
 INSERT INTO separation_ownership SELECT 'companies',id,id FROM companies WHERE "tenantId"=source_id;
 FOR rec IN SELECT c.table_name FROM information_schema.columns c
   WHERE c.table_schema='public' AND c.column_name='companyId' LOOP
   EXECUTE format('INSERT INTO separation_ownership SELECT %L,id,"companyId" FROM public.%I WHERE "companyId" IN (SELECT id FROM companies WHERE "tenantId"=$1) ON CONFLICT DO NOTHING',rec.table_name,rec.table_name) USING source_id;
 END LOOP;
 -- Propagate ownership through real FK metadata, including children lacking tenantId/companyId.
 LOOP
   added:=0;
   FOR rec IN SELECT child.relname AS child_table,parent.relname AS parent_table,ca.attname AS child_column,pa.attname AS parent_column
     FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
     JOIN pg_class parent ON parent.oid=fk.confrelid
     JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
     JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=fk.confkey[1]
     WHERE fk.contype='f' AND ns.nspname='public' AND cardinality(fk.conkey)=1
       AND child.relname<>ALL(ignored) AND parent.relname<>ALL(ignored)
       AND EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=child.relname AND c.column_name='id') LOOP
     IF rec.parent_column <> 'id' THEN RAISE EXCEPTION 'Unsupported non-ID foreign key'; END IF;
     EXECUTE format('INSERT INTO separation_ownership SELECT %L,c.id,o.company_id FROM public.%I c JOIN separation_ownership o ON o.table_name=%L AND o.row_id=c.%I ON CONFLICT DO NOTHING',rec.child_table,rec.child_table,rec.parent_table,rec.child_column);
     GET DIAGNOSTICS changed = ROW_COUNT; added:=added+changed;
   END LOOP;
   EXIT WHEN added=0;
 END LOOP;
 -- Validate the reverse direction as well: an owned child must not retain a
 -- reference to a parent outside the three-company ownership inventory.
 FOR rec IN SELECT child.relname AS child_table,parent.relname AS parent_table,ca.attname AS child_column
   FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
   JOIN pg_class parent ON parent.oid=fk.confrelid
   JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=fk.conkey[1]
   WHERE fk.contype='f' AND ns.nspname='public' AND cardinality(fk.conkey)=1
     AND child.relname<>ALL(ignored) AND parent.relname<>ALL(ignored)
     AND EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=child.relname AND c.column_name='id') LOOP
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I c JOIN separation_ownership own ON own.table_name=%L AND own.row_id=c.id LEFT JOIN separation_ownership parent ON parent.table_name=%L AND parent.row_id=c.%I AND parent.company_id=own.company_id WHERE c.%I IS NOT NULL AND parent.row_id IS NULL)',rec.child_table,rec.child_table,rec.parent_table,rec.child_column,rec.child_column) INTO invalid;
   IF invalid THEN RAISE EXCEPTION 'Foreign parent in %.%',rec.child_table,rec.child_column; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM stock_movements a JOIN stock_movements b ON b."transferGroupId"=a."transferGroupId"
   WHERE a."tenantId"=source_id AND (a."companyId"<>b."companyId" OR a."tenantId"<>b."tenantId")) THEN
   RAISE EXCEPTION 'Cross-company stock transfer requires review';
 END IF;
 -- Polymorphic attachments do not have FK metadata. Preserve object keys and file bytes.
 FOR rec IN SELECT * FROM (VALUES
   ('company','companies'),('customer','customers'),('journal_entry','journal_entries'),
   ('sales_invoice','sales_invoices'),('sales_return','sales_returns'),('receipt','receipts'),
   ('purchase_invoice','purchase_invoices'),('purchase_return','purchase_returns'),('payroll_run','payroll_runs'),
   ('leave_settlement','leave_settlements'),('fixed_asset','fixed_assets'),('employee','employees'),
   ('station_shift_reading','station_shift_readings'),('station_shift_expense','station_shift_expenses')
 ) AS m(entity_type,parent_table) LOOP
   INSERT INTO separation_ownership SELECT 'attachments',a.id,o.company_id FROM attachments a
   JOIN separation_ownership o ON o.table_name=rec.parent_table AND o.row_id=a."entityId"
   WHERE a."tenantId"=source_id AND a."entityType"=rec.entity_type ON CONFLICT DO NOTHING;
 END LOOP;
 IF EXISTS(SELECT 1 FROM separation_ownership GROUP BY table_name,row_id HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Cross-company relationship found; no changes applied';
 END IF;
 -- No orphan tenant-owned rows may be silently left behind (except explicit administrative history).
 FOR rec IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenantId' LOOP
   IF rec.table_name = ANY(ignored) THEN CONTINUE; END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I r LEFT JOIN separation_ownership o ON o.table_name=%L AND o.row_id=r.id WHERE (r."tenantId"=$1 AND o.row_id IS NULL %s) OR (o.row_id IS NOT NULL AND r."tenantId"<>$1))',rec.table_name,rec.table_name,
     CASE WHEN rec.table_name='audit_logs' THEN 'AND r."companyId" IS NOT NULL'
       -- Preserve these two verified orphan records unchanged; never infer a company
       -- from an uploader. The deployed attachment guard denies missing-parent access.
       -- Any other orphan, changed identity/type/uploader, or foreign parent still aborts.
       WHEN rec.table_name='attachments' THEN $filter$
         AND NOT (r."entityType"='journal_entry' AND
           (r.id,r."entityId",r."uploadedBy") IN (
             ('cmt1xk2990009130d2atjkmcn','cmt1xk0an0004130d8whwq453','cmsrchxbb000be8f5jibbjmzn'),
             ('cmtpk5scy0012kclo18agknox','cmtpk5pv2000xkclokyccfhjw','cmtik0ioo000nmxf8mex7qkt9'))
           AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.id=r."entityId"))
       $filter$ ELSE '' END) INTO invalid USING source_id;
   IF invalid THEN RAISE EXCEPTION 'Unresolved or foreign ownership in table %',rec.table_name; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entries r ON r.id=j."reversalOfEntryId" WHERE j."tenantId"=source_id AND (j."companyId"<>r."companyId" OR j."tenantId"<>r."tenantId")) THEN
   RAISE EXCEPTION 'Cross-company reversal requires review';
 END IF;

END $separate$;
SELECT table_name,count(*) AS relationship_count FROM separation_ownership GROUP BY table_name ORDER BY table_name;
ROLLBACK;

DROP TABLE separation_targets,separation_ownership;
