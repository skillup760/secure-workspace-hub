import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'database.sqlite');

const SQL = await initSqlJs({
  locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file),
});

if (!fs.existsSync(dbPath)) {
  console.log('Database not found at', dbPath);
  process.exit(1);
}

const db = new SQL.Database(fs.readFileSync(dbPath));

// Get all table names
const tableStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
const tables = [];
while (tableStmt.step()) {
  tables.push(tableStmt.getAsObject().name);
}
tableStmt.free();

console.log('=== DATABASE INSPECTION ===\n');
console.log('Database file:', dbPath);
console.log('File size:', fs.statSync(dbPath).size, 'bytes');
console.log('Last modified:', fs.statSync(dbPath).mtime);
console.log('\nTables:', tables.join(', '));
console.log('\n=== TABLE CONTENTS ===\n');

for (const table of tables) {
  console.log(`\n--- ${table} ---`);
  const stmt = db.prepare(`SELECT * FROM ${table}`);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  
  if (rows.length === 0) {
    console.log('(empty)');
  } else {
    console.table(rows);
  }
}

console.log('\n=== FILES STORAGE ===\n');
const filesDir = path.join(__dirname, 'data', 'files');
if (fs.existsSync(filesDir)) {
  const files = fs.readdirSync(filesDir);
  console.log(`Files in ${filesDir}:`);
  files.forEach(file => {
    const stats = fs.statSync(path.join(filesDir, file));
    console.log(`  - ${file} (${stats.size} bytes, modified: ${stats.mtime})`);
  });
} else {
  console.log('Files directory does not exist');
}

db.close();
