// Применяет supabase/seed.sql к БД. URL берётся из переменной окружения
// SEED_DB_URL (секреты в репозиторий не коммитятся).
//   PowerShell:  $env:SEED_DB_URL="postgresql://..."; node scripts/seed.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const url = process.env.SEED_DB_URL;
if (!url) {
  console.error("SEED_DB_URL не задан.");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "supabase", "seed.sql"), "utf8");

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log("Сиды применены.");
} catch (e) {
  await client.query("rollback");
  console.error("Ошибка сидов:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
