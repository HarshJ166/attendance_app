import { readFileSync } from 'node:fs';
import { sql } from './index.js';

await sql.unsafe(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
console.log('migrated');
await sql.end();
