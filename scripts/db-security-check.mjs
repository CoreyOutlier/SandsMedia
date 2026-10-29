import assert from "node:assert/strict";
import pg from "pg";

// Run with an explicitly selected environment file. Never print connections,
// database errors, or row contents. The owner check requires an empty consent table.
const guardsOnly = process.argv.includes("--guards-only");
let db;
try {
  const connection = new URL(process.env.DATABASE_URL);
  connection.searchParams.set("sslmode", "verify-full");
  db = new pg.Client({ connectionString: connection.toString() });
  await db.connect();
  const triggers = await db.query("SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.consent_events'::regclass AND NOT tgisinternal");
  assert.equal(triggers.rowCount, 2);
  assert.ok(triggers.rows.every(row => row.tgenabled === "A"));
  if (guardsOnly) {
    const count = await db.query("SELECT count(*)::int AS n FROM consent_events");
    assert.equal(count.rows[0].n, 0, "Owner guard check requires empty consent table");
  } else {
    const role = await db.query("SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user");
    assert.deepEqual(role.rows[0], { name: "posting_center_app", rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false });
    const perms = await db.query("SELECT has_table_privilege(current_user,'consent_events','SELECT') AS read, has_table_privilege(current_user,'consent_events','INSERT') AS append, has_table_privilege(current_user,'consent_events','UPDATE,DELETE,TRUNCATE') AS mutate, has_schema_privilege(current_user,'public','CREATE') AS ddl");
    assert.deepEqual(perms.rows[0], { read: true, append: true, mutate: false, ddl: false });
    const owns = await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tableowner=current_user");
    assert.equal(owns.rows[0].n, 0);
  }
  for (const sql of [
    "UPDATE consent_events SET consented=consented WHERE false",
    "DELETE FROM consent_events WHERE false",
    "TRUNCATE consent_events",
  ]) {
    await db.query("BEGIN");
    let rejected = false;
    try { await db.query(sql); }
    catch (error) {
      rejected = error.code === "42501" && (!guardsOnly || error.message === "Consent records are append-only");
    } finally { await db.query("ROLLBACK"); }
    assert.ok(rejected, "Consent mutation must be denied");
  }
  console.info(guardsOnly ? "Owner-level consent triggers reject update, delete, and truncate." : "Runtime login has only approved privileges; consent update, delete, and truncate are rejected.");
} catch {
  console.error("DATABASE_SECURITY_CHECK_FAILED");
  process.exitCode = 1;
} finally { await db?.end().catch(() => {}); }
