#!/usr/bin/env node
// Cross-platform installer. Runs on Windows / Linux / macOS with just Node 20+.
//   node scripts/setup.mjs
import { mkdirSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { platform } from 'node:os';

const root = process.cwd();
const dataDir = join(root, 'data');
const filesDir = join(dataDir, 'files');
const dbDir   = join(dataDir, 'db');

for (const d of [dataDir, filesDir, dbDir]) {
  mkdirSync(d, { recursive: true });
  console.log('  ok  ', d);
}

const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  const secret = randomBytes(48).toString('base64url');
  const example = existsSync('.env.example') ? '.env.example' : null;
  if (example) copyFileSync(example, envPath);
  writeFileSync(envPath,
    (existsSync(envPath) ? `\n` : '') + `JWT_SECRET=${secret}\n`, { flag: 'a' });
  console.log('  ok   .env generated with random JWT_SECRET');
} else {
  console.log('  skip .env already exists');
}

console.log(`\nPlatform: ${platform()}  Node: ${process.version}`);
console.log('Next:');
console.log('  npm install');
console.log('  npm start         # bare-Node mode');
console.log('  docker compose up -d   # containerised mode');
