// Synthetic legacy rows only. Execute the actual cutover against Prisma-generated DDL.
// Usage: node separation.local.cjs <generated-schema.sql> <cutover.sql>
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('fs');
const assert=require('node:assert/strict');
const source='cmsrchwg90009e8f5fmj3v59l';
const companies=['cmsrciyjv000ge8f57p2azqdd','cmuhc8l5t00f4qjb6uoe4vxx8','cmuttoi4d000cd4o74anj3ibr'];
const schema=fs.readFileSync(process.argv[2],'utf8');
const cutover=fs.readFileSync(process.argv[3],'utf8');
async function fixture() {
 const db=new PGlite(); await db.exec(schema);
 // Install the actual append-only trigger, not a hand-written imitation.
 const archiveMigration=fs.readFileSync(require('path').resolve(__dirname,'../../../prisma/migrations/20260928140000_zatca_document_archive/migration.sql'),'utf8');
 const triggerEnd='FOR EACH STATEMENT EXECUTE FUNCTION zatca_document_archive_immutable();';
 await db.exec(archiveMigration.slice(archiveMigration.indexOf('CREATE FUNCTION zatca_document_archive_immutable()'),archiveMigration.indexOf(triggerEnd)+triggerEnd.length));
 await db.exec(`INSERT INTO tenants(id,name,"unlockPin","updatedAt") VALUES ('${source}','group','test',now()),('other','group','test',now());
 INSERT INTO identities(id,email,"updatedAt") VALUES ('identity','asf@tismpro.sa',now()),('accountant-identity','test@example.invalid',now());
 INSERT INTO users(id,"identityId","tenantId",name,role,"updatedAt") VALUES ('admin','identity','${source}','admin','admin',now());
 INSERT INTO job_titles(id,"tenantId",name,"updatedAt") VALUES ('job','${source}','accountant',now());
 INSERT INTO positions(id,"tenantId",name,"jobTitleId","updatedAt") VALUES ('position','${source}','accountant','job',now());
 INSERT INTO position_permissions(id,"positionId","moduleId","canRead") VALUES ('permission','position','sales',true);
 INSERT INTO users(id,"identityId","tenantId",name,"companyScope","positionId","updatedAt") VALUES ('accountant','accountant-identity','${source}','accountant','${companies[1]}','position',now());
 INSERT INTO refresh_tokens(id,"userId","tokenHash","expiresAt") VALUES ('token','accountant','synthetic',now()+interval '1 day');`);
 for(const [i,id] of [...companies,'other-company'].entries()) {
  const tenant=i===3?'other':source;
  await db.query('INSERT INTO companies(id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())',[id,tenant,i===3?'same':'same'+(i||'')]);
  await db.query('INSERT INTO accounts(id,"tenantId","companyId",code,level,name,type,"updatedAt") VALUES ($1,$2,$3,$4,1,\'test\',\'asset\',now())',['account'+i,tenant,id,'100']);
  await db.query('INSERT INTO journal_entries(id,"tenantId","companyId",date,"entryNumber","createdBy","updatedAt") VALUES ($1,$2,$3,now(),\'J1\',\'admin\',now())',['entry'+i,tenant,id]);
  await db.query('INSERT INTO journal_entry_lines(id,"journalEntryId","accountId",debit) VALUES ($1,$2,$3,$4)',['line'+i,'entry'+i,'account'+i,(i+1)*17]);
 }
 await db.exec(`INSERT INTO attachments(id,"tenantId","entityType","entityId","fileName","fileKey","fileSize","mimeType","uploadedBy") VALUES ('attachment','${source}','journal_entry','entry1','synthetic.xlsx','unchanged-object-key',42,'application/octet-stream','admin');`);
 // Legacy archive metadata; actual signed-document export is tested through its producer in the integration suite.
 await db.query(`INSERT INTO zatca_document_archive(id,"tenantId","companyId","documentType","documentId","documentNumber","documentUuid",icv,"invoiceHash",subtype,"submissionKind","issuedAt",compression,source) VALUES ('archive',$1,$2,'sales_invoice','legacy','LEGACY','uuid',1,'hash','simplified','reporting',now(),'none','backfill')`,[source,companies[1]]);
 return db;
}
(async()=>{
 const db=await fixture();
 const queryDir=require('path').resolve(__dirname,'../../sql/company-separation');
 const inventory=(await db.query(fs.readFileSync(require('path').join(queryDir,'company-separation-preflight.sql'),'utf8'))).rows;
 assert.equal(inventory.length,3); assert(inventory.every(r=>r.tenantId===source));
 const memberships=(await db.query(fs.readFileSync(require('path').join(queryDir,'company-separation-memberships.sql'),'utf8'))).rows;
 assert.equal(memberships.filter(r=>r.kind==='membership').length,2);
 if (process.argv[4]) await db.exec(fs.readFileSync(process.argv[4], "utf8"));
 const valuesBefore=(await db.query('SELECT id,debit,credit FROM journal_entry_lines ORDER BY id')).rows;
 await db.exec(`INSERT INTO attachments(id,"tenantId","entityType","entityId","fileName","fileKey","fileSize","mimeType","uploadedBy") VALUES ('cmt1xk2990009130d2atjkmcn','${source}','journal_entry','cmt1xk0an0004130d8whwq453','orphan.xlsx','preserved-orphan',42,'application/octet-stream','cmsrchxbb000be8f5jibbjmzn');`);
 const orphanBefore=(await db.query("SELECT * FROM attachments WHERE id='cmt1xk2990009130d2atjkmcn'")).rows;
 const archiveBefore=(await db.query('SELECT * FROM zatca_document_archive')).rows;
 await db.exec(cutover);
 const rows=(await db.query('SELECT "tenantId",count(*)::int AS n FROM companies GROUP BY "tenantId"')).rows;
 assert.equal(rows.length,4); assert(rows.every(x=>x.n===1));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM users WHERE "identityId"=\'identity\'')).rows[0].n,3);
 assert.deepEqual((await db.query('SELECT id,debit,credit FROM journal_entry_lines ORDER BY id')).rows,valuesBefore);
 assert.deepEqual((await db.query('SELECT * FROM zatca_document_archive')).rows,archiveBefore);
 await assert.rejects(db.exec(`UPDATE zatca_document_archive SET "tenantId"='other'`),/append-only/);
 assert.deepEqual((await db.query("SELECT * FROM attachments WHERE id='cmt1xk2990009130d2atjkmcn'")).rows,orphanBefore);
 const attachment=(await db.query("SELECT * FROM attachments WHERE id='attachment'")).rows[0];
 const accountant=(await db.query('SELECT * FROM users WHERE id=\'accountant\'')).rows[0];
 assert.equal(attachment.tenantId,accountant.tenantId); assert.equal(attachment.fileKey,'unchanged-object-key'); assert.notEqual(attachment.uploadedBy,'admin');
 assert.notEqual(accountant.positionId,'position');
 assert.equal((await db.query('SELECT "canRead" FROM position_permissions WHERE "positionId"=$1',[accountant.positionId])).rows[0].canRead,true);
 assert((await db.query('SELECT "revokedAt" FROM refresh_tokens')).rows[0].revokedAt);
 assert.equal((await db.query('SELECT "tenantId" FROM companies WHERE id=\'other-company\'')).rows[0].tenantId,'other');
 await db.close();
 console.log('PASS: actual cutover preserves records, amounts, object keys, permissions, unrelated tenant, and revokes old refresh sessions.');
 const failures=[
  ['unknown attachment',`UPDATE attachments SET "entityType"='unknown'`],
  ['unrecognized orphan',`UPDATE attachments SET "entityId"='missing'`],
  ['changed orphan identity',`UPDATE attachments SET id='cmt1xk2990009130d2atjkmcn',"entityId"='cmt1xk0an0004130d8whwq453',"uploadedBy"='different'`],
  ['cross-company account',`UPDATE journal_entry_lines SET "accountId"='account0' WHERE id='line1'`],
  ['foreign parent',`UPDATE journal_entry_lines SET "accountId"='account3' WHERE id='line1'`],
  ['mirror',`UPDATE journal_entries SET "mirrorEntryId"='entry0' WHERE id='entry1'`],
  ['cross-company reversal',`UPDATE journal_entries SET "reversalOfEntryId"='entry0' WHERE id='entry1'`],
  ['reversed mirror',`UPDATE journal_entries SET "mirrorEntryId"='entry0',"reversalOfEntryId"='entry2' WHERE id='entry1'`]
 ];
 for(const [label,sql] of failures) {
  const sample=await fixture(); await sample.exec(sql);
  await assert.rejects(sample.exec(cutover)); await sample.exec('ROLLBACK');
  assert.equal((await sample.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n,2);
  assert.equal((await sample.query('SELECT count(*)::int AS n FROM companies WHERE "tenantId"=$1',[source])).rows[0].n,3);
  console.log('PASS: atomic rollback for '+label); await sample.close();
 }
})().catch(e=>{console.error(e.message);process.exit(1)});
