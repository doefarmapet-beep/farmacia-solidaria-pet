import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'mysql2/promise';
import { mysqlConfig } from './database-config.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const sourcePath = process.env.FARMACIA_SQLITE_PATH || resolve(root, 'data/farmacia-solidaria.sqlite');
if (!existsSync(sourcePath)) throw new Error(`Banco SQLite não encontrado: ${sourcePath}`);

const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
const mysql = await createConnection(mysqlConfig());

try {
  const schema = readFileSync(resolve(root, 'data/schema.mysql.sql'), 'utf8');
  for (const statement of schema.split(';').map((sql) => sql.trim()).filter(Boolean)) {
    await mysql.query(statement);
  }

  const [[{ total: existingUsers }]] = await mysql.query('SELECT COUNT(*) AS total FROM users');
  if (existingUsers > 0) {
    throw new Error('O banco MySQL já contém usuários; a migração foi cancelada para evitar mesclar cadastros.');
  }

  const users = sqlite.prepare(`SELECT id, name, phone, email, birth_date, postal_code, street, district, city, state,
    number, complement, password_hash, password_salt, created_at FROM users`).all();
  const sessions = sqlite.prepare('SELECT token_hash, user_id, expires_at FROM sessions').all();

  await mysql.beginTransaction();
  try {
    for (const user of users) {
      await mysql.execute(`INSERT INTO users (id, name, phone, email, birth_date, postal_code, street, district, city, state,
        number, complement, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        user.id, user.name, user.phone, user.email, user.birth_date, user.postal_code, user.street, user.district,
        user.city, user.state, user.number, user.complement, user.password_hash, user.password_salt, user.created_at,
      ]);
    }
    for (const session of sessions) {
      await mysql.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
        session.token_hash, session.user_id, session.expires_at,
      ]);
    }
    await mysql.commit();
  } catch (error) {
    await mysql.rollback();
    throw error;
  }

  console.log(`Migração concluída: ${users.length} usuário(s) e ${sessions.length} sessão(ões).`);
} finally {
  sqlite.close();
  await mysql.end();
}