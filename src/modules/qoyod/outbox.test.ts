import { readFileSync } from "fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect } from "vitest";

describe("Qoyod atomic outbox and immutable dispatch", () => {
  it("captures only enabled/new posting, rolls back with posting and guards dispatched lines", async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE companies(id text primary key);
      CREATE TABLE journal_entries(id text primary key, "companyId" text, status text, memo text);
      CREATE TABLE journal_entry_lines(id text primary key, "journalEntryId" text REFERENCES journal_entries(id), debit numeric);
      INSERT INTO companies VALUES('a'),('b');`);
      await db.exec(readFileSync("prisma/migrations/20261015081500_qoyod_journal_outbox/migration.sql", "utf8"));
      await db.exec(`INSERT INTO journal_entries VALUES('old','a','posted',null);
      INSERT INTO qoyod_connections(id,"apiKeyEnc",enabled) VALUES('a','encrypted',true);
      INSERT INTO journal_entries VALUES('draft','a','saved',null),('other','b','posted',null),('new','a','posted',null);
      INSERT INTO journal_entry_lines VALUES('line','new',10);`);
      expect((await db.query(`SELECT id AS "entryId" FROM qoyod_journal_exports`)).rows).toEqual([{ entryId: "new" }]);
      await db.exec(`BEGIN; UPDATE journal_entries SET status='posted' WHERE id='draft'; ROLLBACK;`);
      expect((await db.query(`SELECT count(*)::int AS n FROM qoyod_journal_exports`)).rows).toEqual([{ n: 1 }]);
      await db.exec(`UPDATE journal_entries SET status='posted' WHERE id='draft'; UPDATE journal_entries SET memo='updated' WHERE id='new';`);
      for (const status of ["sending", "sent", "uncertain"]) {
        await db.exec(`UPDATE qoyod_journal_exports SET status='${status}' WHERE id='new'`);
        await expect(db.exec(`UPDATE journal_entry_lines SET debit=11 WHERE id='line'`)).rejects.toThrow();
        await expect(db.exec(`UPDATE journal_entries SET status='saved' WHERE id='new'`)).rejects.toThrow();
        await expect(db.exec(`INSERT INTO journal_entry_lines VALUES('extra','new',1)`)).rejects.toThrow();
      }
      await db.exec(`UPDATE qoyod_connections SET enabled=false WHERE id='a'; INSERT INTO journal_entries VALUES('paused','a','posted',null);`);
      expect((await db.query(`SELECT count(*)::int AS n FROM qoyod_journal_exports`)).rows).toEqual([{ n: 2 }]);
    } finally { await db.close(); }
  }, 30000);
});
