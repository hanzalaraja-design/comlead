// Run supabase/tests/rls_test.sql against the Supabase project. The test
// creates throwaway users and data inside a transaction and rolls back, so
// nothing is left behind. Any failed check aborts with "FAIL: ...".
import fs from "node:fs";
import { runSql } from "./supabase-api.mjs";

try {
  await runSql(fs.readFileSync("supabase/tests/rls_test.sql", "utf8"));
  console.log("ALL RLS TESTS PASSED");
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}
