import 'dotenv/config';
import { db } from './db.js';

const TABLES = ['traders', 'challenges', 'payouts', 'kyc_documents'];

console.log('Checking SQLite database…\n');

let allReady = true;
for (const table of TABLES) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  console.log(`  ${row ? '✓' : '✗'} ${table}`);
  if (!row) allReady = false;
}

console.log('');
if (allReady) {
  console.log('✅ Database is ready — all tables exist!');
  console.log('   Run "node server.js" (or "npm run dev") to start the API.\n');
} else {
  console.log('⚠  Tables are missing — this should not happen, since backend/db.js');
  console.log('   applies backend/db/schema.sql automatically on startup.');
  console.log('   Try starting the server once, then run this script again.\n');
}
