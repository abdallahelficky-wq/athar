CREATE TABLE qoyod_connections (
 "companyId" TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE RESTRICT,
 "apiKeyEnc" TEXT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false,
 mapping JSONB NOT NULL DEFAULT '{"accounts":{},"contacts":{}}',
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE qoyod_journal_exports (
 "entryId" TEXT PRIMARY KEY REFERENCES journal_entries(id) ON DELETE RESTRICT,
 "companyId" TEXT NOT NULL REFERENCES qoyod_connections("companyId") ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','blocked','sending','sent','uncertain')),
 "remoteId" INTEGER,
 error TEXT,
 payload JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX qoyod_export_queue ON qoyod_journal_exports(status,"createdAt");
CREATE UNIQUE INDEX qoyod_export_remote ON qoyod_journal_exports("companyId","remoteId");

-- Capture posting in the same transaction, including generated/bulk journal entries.
-- No historical scan, and no network call inside the financial transaction.
CREATE FUNCTION qoyod_enqueue_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status::text = 'posted' AND (TG_OP = 'INSERT' OR OLD.status::text <> 'posted') THEN
  IF EXISTS (SELECT 1 FROM qoyod_connections WHERE "companyId"=NEW."companyId" AND enabled) THEN
   INSERT INTO qoyod_journal_exports("entryId","companyId") VALUES(NEW.id,NEW."companyId") ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER qoyod_enqueue AFTER INSERT OR UPDATE OF status ON journal_entries FOR EACH ROW EXECUTE FUNCTION qoyod_enqueue_journal();

-- Once dispatch starts, correction is by a reversing entry, never by silently changing exported amounts.
CREATE FUNCTION qoyod_guard_exported_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_id TEXT;
BEGIN
 IF TG_TABLE_NAME='journal_entries' THEN entry_id=OLD.id;
 ELSE entry_id=CASE WHEN TG_OP='INSERT' THEN NEW."journalEntryId" ELSE OLD."journalEntryId" END;
 END IF;
 PERFORM id FROM journal_entries WHERE id=entry_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM qoyod_journal_exports WHERE "entryId"=entry_id AND status IN ('sending','sent','uncertain')) THEN
  RAISE EXCEPTION 'القيد أرسل إلى قيود أو قيد التحقق؛ استخدم قيدًا عكسيًا للتصحيح';
 END IF;
 IF TG_TABLE_NAME='journal_entry_lines' THEN
  IF TG_OP='UPDATE' THEN
   IF NEW."journalEntryId"<>OLD."journalEntryId" THEN
    PERFORM id FROM journal_entries WHERE id=NEW."journalEntryId" FOR UPDATE;
    IF EXISTS(SELECT 1 FROM qoyod_journal_exports WHERE "entryId"=NEW."journalEntryId" AND status IN ('sending','sent','uncertain')) THEN RAISE EXCEPTION 'Cannot modify exported Qoyod entry'; END IF;
   END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER qoyod_guard_header BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION qoyod_guard_exported_journal();
CREATE TRIGGER qoyod_guard_lines BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines FOR EACH ROW EXECUTE FUNCTION qoyod_guard_exported_journal();
