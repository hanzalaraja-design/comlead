// Apply pending migrations in supabase/migrations to the Supabase project,
// then (with --seed) run supabase/seed.sql. Each migration runs in its own
// transaction and is recorded in supabase_migrations.schema_migrations, the
// same table `supabase db push` uses, so the two can be mixed later.
//   npm run db:push            # migrations only
//   npm run db:push -- --seed  # migrations + seed
import fs from "node:fs";
import path from "node:path";
import { runSql } from "./supabase-api.mjs";

const dir = "supabase/migrations";
const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

await runSql(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text);
`);
const applied = new Set((await runSql("select version from supabase_migrations.schema_migrations")).map((r) => r.version));

const quote = (s) => `$migration$${s}$migration$`;
let count = 0;
for (const file of files) {
  const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
  if (applied.has(version)) continue;
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  process.stdout.write(`applying ${file} … `);
  await runSql(`begin;
${sql}
;
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('${version}', '${rest.join("_")}', array[${quote(sql)}]);
commit;`);
  console.log("done");
  count++;
}
console.log(count ? `${count} migration(s) applied.` : "Database is up to date.");

if (process.argv.includes("--seed")) {
  await runSql(fs.readFileSync("supabase/seed.sql", "utf8"));
  console.log("Seed applied (departments and sub-teams).");
}
