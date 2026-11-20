import { readFile, writeFile } from "node:fs/promises";
import { unstable_splitSqlQuery } from "wrangler";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error("Kullanım: node scripts/prepare-d1-restore.mjs <kaynak.sql> <geri-yukleme.sql>");
  process.exit(1);
}

// D1 exports may interleave table definitions and data. References to a
// table that does not exist yet fail even with deferred foreign keys.
const tables = [];
const indexes = [];
const data = [];
const schemaAfterData = [];
for (const statement of unstable_splitSqlQuery(await readFile(source, "utf8"))) {
  const sql = statement.trim().replace(/;$/, "");
  if (!sql || /^PRAGMA\s+defer_foreign_keys\b/i.test(sql)) continue;
  if (/^CREATE\s+TABLE\b/i.test(sql)) tables.push(sql);
  else if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(sql)) indexes.push(sql);
  else if (/^CREATE\s+(?:TRIGGER|VIEW)\b/i.test(sql)) schemaAfterData.push(sql);
  else if (/^(?:INSERT\s+INTO\b|DELETE\s+FROM\s+"?sqlite_sequence"?$|ANALYZE\s+sqlite_schema$)/i.test(sql)) data.push(sql);
  else throw new Error("D1 dökümünde desteklenmeyen bir ifade var. Kaynak dosya korunuyor.");
}
if (!tables.length) throw new Error("D1 dökümü tablo şeması içermiyor.");
await writeFile(destination, [
  "PRAGMA defer_foreign_keys=TRUE",
  ...tables, ...indexes, ...data, ...schemaAfterData
].join(";\n") + ";\n", { flag: "wx", mode: 0o600 });
