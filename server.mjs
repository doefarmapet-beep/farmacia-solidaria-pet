import { createServer } from 'node:http';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createPool } from 'mysql2/promise';
import { mysqlConfig } from './database-config.mjs';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const database = createPool({
  ...mysqlConfig(),
  waitForConnections: true,
  connectionLimit: 10,
});

let databaseInitialization;
function initializeDatabase() {
  if (!databaseInitialization) {
    databaseInitialization = (async () => {
      const schema = readFileSync(resolve(root, 'data/schema.mysql.sql'), 'utf8');
      for (const statement of schema.split(';').map((sql) => sql.trim()).filter(Boolean)) {
        await database.query(statement);
      }
    })().catch((error) => {
      databaseInitialization = undefined;
      throw error;
    });
  }
  return databaseInitialization;
}

const publicUserFields = 'id, name, phone, email, birth_date, postal_code, street, district, city, state, number, complement';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_768) throw Object.assign(new Error('Requisição muito grande.'), { status: 413 });
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { status: 400 });
  }
}

function normalizeProfile(input) {
  return {
    name: String(input.name || '').trim(),
    phone: String(input.phone || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    birth_date: String(input.birth_date || '').trim(),
    postal_code: String(input.postal_code || '').trim(),
    street: String(input.street || '').trim(),
    district: String(input.district || '').trim(),
    city: String(input.city || '').trim(),
    state: String(input.state || '').trim().toUpperCase(),
    number: String(input.number || '').trim(),
    complement: String(input.complement || '').trim(),
  };
}

function validateProfile(profile) {
  if (Object.values(profile).some((value, index) => index !== 10 && !value)) {
    return 'Preencha todos os campos obrigatórios.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) return 'Informe um e-mail válido.';
  return null;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionCookieFlags() {
  return `HttpOnly; SameSite=Strict; Path=/${process.env.VERCEL ? '; Secure' : ''}`;
}

function isUniqueConstraint(error) {
  return error.code === 'ER_DUP_ENTRY' || error.errno === 1062;
}

async function sessionUser(request) {
  const token = request.headers.cookie?.match(/(?:^|;\s*)farmacia_session=([^;]+)/)?.[1];
  if (!token) return null;
  const tokenHash = hashToken(decodeURIComponent(token));
  const [sessions] = await database.execute('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', [tokenHash]);
  const session = sessions[0];
  if (!session) return null;
  if (Number(session.expires_at) <= Date.now()) {
    await database.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    return null;
  }
  return session.user_id;
}

async function handleApi(request, response, url) {
  const route = `${request.method} ${url.pathname}`;

  if (route === 'POST /api/register') {
    const input = await readJson(request);
    const profile = normalizeProfile(input);
    const invalidProfile = validateProfile(profile);
    if (invalidProfile) return sendJson(response, 400, { error: invalidProfile });
    if (typeof input.password !== 'string' || input.password.length < 6) {
      return sendJson(response, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' });
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(input.password, salt, 64)).toString('hex');
    try {
      await database.execute(`INSERT INTO users (name, phone, email, birth_date, postal_code, street, district, city, state, number, complement, password_hash, password_salt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        profile.name, profile.phone, profile.email, profile.birth_date, profile.postal_code,
        profile.street, profile.district, profile.city, profile.state, profile.number,
        profile.complement, passwordHash, salt,
      ]);
      return sendJson(response, 201, { message: 'Cadastro realizado com sucesso.' });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        return sendJson(response, 409, { error: 'Este e-mail já está cadastrado.' });
      }
      throw error;
    }
  }

  if (route === 'POST /api/login') {
    const input = await readJson(request);
    const email = String(input.email || '').trim().toLowerCase();
    const [users] = await database.execute('SELECT id, password_hash, password_salt FROM users WHERE email = ?', [email]);
    const user = users[0];
    if (!user || typeof input.password !== 'string') {
      return sendJson(response, 401, { error: 'E-mail ou senha incorretos.' });
    }
    const attemptedHash = await scrypt(input.password, user.password_salt, 64);
    const savedHash = Buffer.from(user.password_hash, 'hex');
    if (!timingSafeEqual(attemptedHash, savedHash)) {
      return sendJson(response, 401, { error: 'E-mail ou senha incorretos.' });
    }
    const token = randomBytes(32).toString('hex');
    await database.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [hashToken(token), user.id, Date.now() + 7 * 24 * 60 * 60 * 1000]);
    return sendJson(response, 200, { message: 'Login realizado.' }, {
      'Set-Cookie': `farmacia_session=${token}; ${sessionCookieFlags()}; Max-Age=${7 * 24 * 60 * 60}`,
    });
  }

  if (route === 'POST /api/logout') {
    const userId = await sessionUser(request);
    if (userId) {
      const token = request.headers.cookie?.match(/(?:^|;\s*)farmacia_session=([^;]+)/)?.[1];
      if (token) await database.execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(decodeURIComponent(token))]);
    }
    return sendJson(response, 200, { message: 'Sessão encerrada.' }, {
      'Set-Cookie': `farmacia_session=; ${sessionCookieFlags()}; Max-Age=0`,
    });
  }

  const userId = await sessionUser(request);
  if (route === 'GET /api/me') {
    if (!userId) return sendJson(response, 401, { error: 'Faça login para continuar.' });
    const [users] = await database.execute(`SELECT ${publicUserFields} FROM users WHERE id = ?`, [userId]);
    const user = users[0];
    return sendJson(response, 200, user);
  }

  if (route === 'PUT /api/me') {
    if (!userId) return sendJson(response, 401, { error: 'Faça login para continuar.' });
    const input = await readJson(request);
    const profile = normalizeProfile(input);
    const invalidProfile = validateProfile(profile);
    if (invalidProfile) return sendJson(response, 400, { error: invalidProfile });
    if (input.password && input.password.length < 6) {
      return sendJson(response, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' });
    }
    try {
      await database.execute(`UPDATE users SET name = ?, phone = ?, email = ?, birth_date = ?, postal_code = ?, street = ?, district = ?, city = ?, state = ?, number = ?, complement = ? WHERE id = ?`,
        [profile.name, profile.phone, profile.email, profile.birth_date, profile.postal_code,
          profile.street, profile.district, profile.city, profile.state, profile.number, profile.complement, userId]);
      if (input.password) {
        const salt = randomBytes(16).toString('hex');
        const passwordHash = (await scrypt(input.password, salt, 64)).toString('hex');
        await database.execute('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [passwordHash, salt, userId]);
      }
      return sendJson(response, 200, { message: 'Cadastro atualizado com sucesso.' });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        return sendJson(response, 409, { error: 'Este e-mail já está cadastrado.' });
      }
      throw error;
    }
  }

  if (route === 'POST /api/password-reset-request') {
    return sendJson(response, 501, { error: 'Envio de e-mail não está configurado no banco local. Entre em contato com o administrador.' });
  }

  return sendJson(response, 404, { error: 'Rota não encontrada.' });
}

function serveStatic(request, response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  } catch {
    response.writeHead(400).end('URL inválida.');
    return;
  }
  if (pathname.split('/').some((part) => part.startsWith('.')) || pathname.startsWith('/data/')) {
    response.writeHead(404).end('Não encontrado.');
    return;
  }
  const filePath = resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${sep}`) || !statSyncSafe(filePath)) {
    response.writeHead(404).end('Não encontrado.');
    return;
  }
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
  response.end(readFileSync(filePath));
}

function statSyncSafe(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
    } else if (request.method === 'GET') {
      serveStatic(request, response, url);
    } else {
      sendJson(response, 405, { error: 'Método não permitido.' });
    }
  } catch (error) {
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : 'Erro interno do servidor.' });
    else response.destroy();
    if (!error.status) console.error(error);
  }
});

export async function handleVercelRequest(request, response) {
  try {
    await initializeDatabase();
    const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
    await handleApi(request, response, url);
  } catch (error) {
    if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : 'Erro interno do servidor.' });
    else response.destroy();
    if (!error.status) console.error(error);
  }
}

async function startServer() {
  try {
    await initializeDatabase();
    server.listen(port, process.env.HOST || '127.0.0.1', () => {
      console.log(`DoeFarmaPet disponível em http://localhost:${port}`);
      const mysqlTarget = process.env.MYSQL_URL || `${process.env.MYSQL_HOST || '127.0.0.1'}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE || 'farmacia_solidaria'}`;
      console.log(`MySQL: ${process.env.MYSQL_URL ? 'URL configurada' : mysqlTarget}`);
    });
  } catch (error) {
    console.error(`Não foi possível conectar ao MySQL: ${error.message}`);
    await database.end();
    process.exitCode = 1;
  }
}

if (!process.env.VERCEL) startServer();
