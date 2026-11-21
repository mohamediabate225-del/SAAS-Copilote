import 'dotenv/config';
import { DatabaseSync, backup } from 'node:sqlite';
import { resolve } from 'node:path';
import { mkdir, chmod } from 'node:fs/promises';

const source = resolve(process.env.COPILOTE_DB_PATH || 'copilote-local.sqlite');
const directory = resolve(process.env.BACKUP_DIR || 'backups');
await mkdir(directory, {recursive:true, mode:0o700});
const target = resolve(directory, `copilote-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const database = new DatabaseSync(source, {readOnly:true});
try {
  await backup(database, target);
  await chmod(target,0o600);
  console.log(`Sauvegarde créée : ${target}`);
} finally { database.close(); }
