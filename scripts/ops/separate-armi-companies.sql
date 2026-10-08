-- Requires deployed current-membership validation in authenticate first.
-- Run the complete transaction, never individual statements. Any unresolved
-- ownership, new tenant-only table or cross-company link aborts the whole move.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
CREATE TEMP TABLE separation_targets(company_id text PRIMARY KEY, tenant_id text UNIQUE, admin_id text UNIQUE) ON COMMIT DROP;
INSERT INTO separation_targets VALUES
 ('cmuhc8l5t00f4qjb6uoe4vxx8','split_'||md5('cmuhc8l5t00f4qjb6uoe4vxx8'),'split_'||md5('admin:cmuhc8l5t00f4qjb6uoe4vxx8')),
 ('cmuttoi4d000cd4o74anj3ibr','split_'||md5('cmuttoi4d000cd4o74anj3ibr'),'split_'||md5('admin:cmuttoi4d000cd4o74anj3ibr'));
CREATE TEMP TABLE separation_ownership(table_name text, row_id text, company_id text, PRIMARY KEY(table_name,row_id,company_id)) ON COMMIT DROP;
DO $separate$
DECLARE
 source_id constant text := 'cmsrchwg90009e8f5fmj3v59l';
 retained_company constant text := 'cmsrciyjv000ge8f57p2azqdd';
 owner_id text;
 rec record; target record; obj record; changed int; added int; invalid boolean;
 table_id text; type_name text;
 ignored text[] := ARRAY['tenants','users','identities','refresh_tokens','password_reset_tokens','positions','job_titles','position_permissions','position_action_permissions','user_action_permission_overrides','platform_notices'];
BEGIN
 -- Prevent concurrent inserts/updates into any related table while determining ownership.
 FOR rec IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename LOOP
   EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',rec.tablename);
 END LOOP;
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
     CASE WHEN rec.table_name='audit_logs' THEN 'AND r."companyId" IS NOT NULL' ELSE '' END) INTO invalid USING source_id;
   IF invalid THEN RAISE EXCEPTION 'Unresolved or foreign ownership in table %',rec.table_name; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM journal_entries j JOIN journal_entries r ON r.id=j."reversalOfEntryId" WHERE j."tenantId"=source_id AND (j."companyId"<>r."companyId" OR j."tenantId"<>r."tenantId")) THEN
   RAISE EXCEPTION 'Cross-company reversal requires review';
 END IF;
 FOR target IN SELECT * FROM separation_targets LOOP
   INSERT INTO tenants SELECT (jsonb_populate_record(NULL::tenants,to_jsonb(t)||jsonb_build_object(
     'id',target.tenant_id,'name',c.name,'code',nextval(pg_get_serial_sequence('tenants','code')),
     'ownerId',target.admin_id,'createdAt',now(),'updatedAt',now()))).* FROM tenants t JOIN companies c ON c.id=target.company_id WHERE t.id=source_id;
   INSERT INTO users SELECT (jsonb_populate_record(NULL::users,to_jsonb(u)||jsonb_build_object(
     'id',target.admin_id,'tenantId',target.tenant_id,'companyScope',target.company_id,'positionId',NULL,
     'inviteToken',NULL,'inviteExpiresAt',NULL,'lastLoginAt',NULL,'createdAt',now(),'updatedAt',now()))).* FROM users u WHERE u.id=owner_id;
   INSERT INTO job_titles SELECT (jsonb_populate_record(NULL::job_titles,to_jsonb(j)||jsonb_build_object(
     'id','split_'||md5(target.tenant_id||':'||j.id),'tenantId',target.tenant_id))).* FROM job_titles j WHERE j."tenantId"=source_id;
   INSERT INTO positions SELECT (jsonb_populate_record(NULL::positions,to_jsonb(p)||jsonb_build_object(
     'id','split_'||md5(target.tenant_id||':'||p.id),'tenantId',target.tenant_id,
     'jobTitleId',CASE WHEN p."jobTitleId" IS NULL THEN NULL ELSE 'split_'||md5(target.tenant_id||':'||p."jobTitleId") END))).* FROM positions p WHERE p."tenantId"=source_id;
   FOR table_id IN SELECT unnest(ARRAY['position_permissions','position_action_permissions']) LOOP
     EXECUTE format('INSERT INTO public.%1$I SELECT (jsonb_populate_record(NULL::public.%1$I,to_jsonb(x)||jsonb_build_object(''id'',''split_''||md5($1||'':''||x.id),''positionId'',''split_''||md5($1||'':''||x."positionId")))).* FROM public.%1$I x JOIN positions p ON p.id=x."positionId" WHERE p."tenantId"=$2',table_id) USING target.tenant_id,source_id;
   END LOOP;
   UPDATE users SET "tenantId"=target.tenant_id,"positionId"=CASE WHEN "positionId" IS NULL THEN NULL ELSE 'split_'||md5(target.tenant_id||':'||"positionId") END,"updatedAt"=now()
   WHERE "tenantId"=source_id AND "companyScope"=target.company_id AND id<>owner_id;
   FOR rec IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenantId' LOOP
     IF rec.table_name=ANY(ignored) THEN CONTINUE; END IF;
     EXECUTE format('UPDATE public.%I r SET "tenantId"=$1 FROM separation_ownership o WHERE o.table_name=%L AND o.row_id=r.id AND o.company_id=$2 AND r."tenantId"=$3',rec.table_name,rec.table_name) USING target.tenant_id,target.company_id,source_id;
   END LOOP;
   FOR rec IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('createdBy','uploadedBy','reviewedByUserId','userId') AND table_name<>ALL(ignored) LOOP
     EXECUTE format('UPDATE public.%I r SET %I=$1 FROM separation_ownership o WHERE o.table_name=%L AND o.row_id=r.id AND o.company_id=$2 AND r.%I=$3',rec.table_name,rec.column_name,rec.table_name,rec.column_name) USING target.admin_id,target.company_id,owner_id;
   END LOOP;
 END LOOP;
 UPDATE users SET "companyScope"=retained_company,"updatedAt"=now() WHERE id=owner_id;
 UPDATE tenants SET name=(SELECT name FROM companies WHERE id=retained_company),"updatedAt"=now() WHERE id=source_id;
 UPDATE refresh_tokens SET "revokedAt"=now() WHERE "userId" IN (SELECT id FROM users WHERE "tenantId"=source_id OR "tenantId" IN (SELECT tenant_id FROM separation_targets));
 IF EXISTS(SELECT 1 FROM tenants t WHERE (t.id=source_id OR t.id IN (SELECT tenant_id FROM separation_targets)) AND (SELECT count(*) FROM companies c WHERE c."tenantId"=t.id)<>1) THEN
   RAISE EXCEPTION 'Postcondition failed: each tenant must have exactly one company';
 END IF;
END $separate$;
COMMIT;
