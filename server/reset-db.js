import { existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const dbPath = resolve(rootDir, process.env.DATABASE_PATH || "./data/abendkasse.sqlite");

const files = [dbPath, `${dbPath}-shm`, `${dbPath}-wal`];

let removed = 0;
for (const f of files) {
  if (existsSync(f)) {
    try {
      unlinkSync(f);
      console.log(`Deleted: ${f}`);
      removed++;
    } catch (err) {
      console.error(`Failed to delete ${f}:`, err.message);
    }
  } else {
    console.log(`Not found: ${f}`);
  }
}

if (removed === 0) console.log("No database files were removed.");
else console.log(`Removed ${removed} file(s).`);
console.log("Start the server (npm run dev or npm start) to recreate the database and seed data.");
