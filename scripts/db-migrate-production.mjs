import mysql from "mysql2/promise";
import { spawnSync } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }
const connection = await mysql.createConnection(url);
const [rows] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('users','products','addresses','orders','order_items','coupons','favorites','reviews')");
const tableCount = Number(rows[0].count);
await connection.end();

if (tableCount === 0) {
  console.log("Empty database detected: applying the complete ordered migration chain.");
} else if (tableCount === 8) {
  console.log("Existing schema detected: running orphan preflight before migrations.");
  const preflight = spawnSync("pnpm", ["db:preflight"], { stdio: "inherit", shell: true, env: process.env });
  if (preflight.status !== 0) process.exit(preflight.status ?? 1);
} else {
  console.error(`Incomplete schema detected (${tableCount}/8 tables). Repair or restore the database before migrating.`);
  process.exit(1);
}
const migration = spawnSync("pnpm", ["drizzle-kit", "migrate"], { stdio: "inherit", shell: true, env: process.env });
if (migration.status !== 0) process.exit(migration.status ?? 1);
const postflight = spawnSync("pnpm", ["db:preflight"], { stdio: "inherit", shell: true, env: process.env });
process.exit(postflight.status ?? 1);
