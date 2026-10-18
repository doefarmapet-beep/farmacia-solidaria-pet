import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const profileFields = 'name, phone, birth_date, postal_code, street, district, city, state, number, complement';
const pageAliases = new Map([
  ['/nossa-historia', '/nossa-historia.html'],
  ['/ongs', '/ongs.html'],
  ['/clinicas', '/clinicas.html'],
  ['/privacidade', '/privacidade.html'],
  ['/privacidades', '/privacidade.html'],
  ['/painel', '/painel.html'],
]);
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
  const birthDate = new Date(`${profile.birth_date}T00:00:00.000Z`);
  if (Number.isNaN(birthDate.valueOf()) || birthDate.toISOString().slice(0, 10) !== profile.birth_date) {
    return 'Informe uma data de nascimento válida.';
  }
  if (!/^[A-Z]{2}$/.test(profile.state)) return 'Informe uma sigla de estado válida.';
  return null;
}

function normalizePartner(input) {
  return {
    partner_type: String(input.partner_type || '').trim().toLowerCase(),
    name: String(input.name || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    phone: String(input.phone || '').trim(),
    city: String(input.city || '').trim(),
    state: String(input.state || '').trim().toUpperCase(),
    website: String(input.website || '').trim(),
    description: String(input.description || '').trim(),
  };
}

function validatePartner(partner) {
  if (!['ong', 'clinic'].includes(partner.partner_type)) return 'Tipo de parceiro inválido.';
  if (partner.name.length < 2 || partner.name.length > 160) return 'O nome deve ter entre 2 e 160 caracteres.';
  if (partner.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partner.email)) return 'Informe um e-mail válido.';
  if (partner.phone.length < 8 || partner.phone.length > 40) return 'Informe um telefone válido.';
  if (!partner.city || partner.city.length > 120) return 'Informe uma cidade válida.';
  if (!/^[A-Z]{2}$/.test(partner.state)) return 'Informe uma sigla de estado válida.';
  if (!partner.description || partner.description.length > 1200) return 'A apresentação deve ter até 1.200 caracteres.';
  if (partner.website) {
    if (partner.website.length > 500) return 'O site deve ter até 500 caracteres.';
    try {
      const website = new URL(partner.website);
      if (!['http:', 'https:'].includes(website.protocol)) return 'O site deve começar com http:// ou https://.';
    } catch {
      return 'Informe uma URL válida para o site.';
    }
  }
  return null;
}

function supabaseHeaders(accessToken) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY no ambiente.');
  }
  return {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken || supabaseAnonKey}`,
    'Content-Type': 'application/json',
  };
}

function sessionCookieFlags() {
  return `HttpOnly; SameSite=Strict; Path=/${process.env.VERCEL ? '; Secure' : ''}`;
}

function sessionCookies(session) {
  const flags = sessionCookieFlags();
  const accessMaxAge = Math.max(0, Number(session.expires_in) || 3600);
  return [
    `farmacia_access=${encodeURIComponent(session.access_token)}; ${flags}; Max-Age=${accessMaxAge}`,
    `farmacia_refresh=${encodeURIComponent(session.refresh_token)}; ${flags}; Max-Age=${60 * 60 * 24 * 30}`,
  ];
}

function clearSessionCookies() {
  const flags = sessionCookieFlags();
  return [
    `farmacia_access=; ${flags}; Max-Age=0`,
    `farmacia_refresh=; ${flags}; Max-Age=0`,
  ];
}

function cookieValue(request, name) {
  const value = request.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
  return value ? decodeURIComponent(value) : null;
}

async function supabaseRequest(path, { method = 'GET', accessToken, body, prefer } = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      ...supabaseHeaders(accessToken),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Supabase retornou uma resposta inválida (${response.status}).`);
    }
  }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || 'Falha na comunicação com o Supabase.';
    throw Object.assign(new Error(message), {
      status: response.status,
      code: data?.code,
    });
  }
  return data;
}

async function authenticatedUser(request, response) {
  let accessToken = cookieValue(request, 'farmacia_access');
  const refreshToken = cookieValue(request, 'farmacia_refresh');
  if (!accessToken) return null;

  try {
    const user = await supabaseRequest('/auth/v1/user', { accessToken });
    return { user, accessToken };
  } catch (error) {
    if (error.status !== 401 && error.status !== 403) throw error;
    if (!refreshToken) {
      response.setHeader('Set-Cookie', clearSessionCookies());
      return null;
    }
  }

  let session;
  try {
    session = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    });
  } catch (error) {
    if (error.status === 400 || error.status === 401) {
      response.setHeader('Set-Cookie', clearSessionCookies());
      return null;
    }
    throw error;
  }
  response.setHeader('Set-Cookie', sessionCookies(session));
  accessToken = session.access_token;
  const user = await supabaseRequest('/auth/v1/user', { accessToken });
  return { user, accessToken };
}

async function handleApi(request, response, url) {
  const route = `${request.method} ${url.pathname}`;

  if (route === 'GET /api/partners') {
    const partnerType = url.searchParams.get('type');
    if (!['ong', 'clinic'].includes(partnerType)) {
      return sendJson(response, 400, { error: 'Tipo de parceiro inválido.' });
    }
    const query = new URLSearchParams({
      select: 'id,partner_type,name,city,state,website,description,created_at',
      partner_type: `eq.${partnerType}`,
      status: 'eq.approved',
      order: 'name.asc',
    });
    const partners = await supabaseRequest(`/rest/v1/partners?${query}`);
    return sendJson(response, 200, partners);
  }

  if (route === 'POST /api/partners') {
    const input = await readJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return sendJson(response, 400, { error: 'Dados de parceiro inválidos.' });
    }
    const partner = normalizePartner(input);
    const invalidPartner = validatePartner(partner);
    if (invalidPartner) return sendJson(response, 400, { error: invalidPartner });
    await supabaseRequest('/rest/v1/partners', {
      method: 'POST',
      prefer: 'return=minimal',
      body: partner,
    });
    return sendJson(response, 201, {
      message: 'Solicitação enviada. Ela ficará pendente até ser analisada e aprovada pela equipe.',
    });
  }

  if (route === 'POST /api/register') {
    const input = await readJson(request);
    const profile = normalizeProfile(input);
    const invalidProfile = validateProfile(profile);
    if (invalidProfile) return sendJson(response, 400, { error: invalidProfile });
    if (typeof input.password !== 'string' || input.password.length < 6) {
      return sendJson(response, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' });
    }
    try {
      const result = await supabaseRequest('/auth/v1/signup', {
        method: 'POST',
        body: { email: profile.email, password: input.password, data: profile },
      });
      const session = result.access_token ? result : null;
      const headers = session ? { 'Set-Cookie': sessionCookies(session) } : {};
      const message = session
        ? 'Cadastro realizado com sucesso.'
        : 'Cadastro realizado. Verifique seu e-mail para confirmar a conta.';
      return sendJson(response, 201, { message }, headers);
    } catch (error) {
      if (error.status === 422 || error.code === 'user_already_exists') {
        return sendJson(response, 409, { error: 'Este e-mail já está cadastrado.' });
      }
      throw error;
    }
  }

  if (route === 'POST /api/login') {
    const input = await readJson(request);
    const email = String(input.email || '').trim().toLowerCase();
    if (typeof input.password !== 'string') {
      return sendJson(response, 401, { error: 'E-mail ou senha incorretos.' });
    }
    let session;
    try {
      session = await supabaseRequest('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email, password: input.password },
      });
    } catch (error) {
      if (error.status === 400 || error.status === 401) {
        return sendJson(response, 401, { error: 'E-mail ou senha incorretos.' });
      }
      throw error;
    }
    if (!session.access_token || !session.refresh_token) {
      throw new Error('O Supabase não retornou uma sessão válida.');
    }
    return sendJson(response, 200, { message: 'Login realizado.' }, {
      'Set-Cookie': sessionCookies(session),
    });
  }

  if (route === 'POST /api/logout') {
    const accessToken = cookieValue(request, 'farmacia_access');
    try {
      if (accessToken) await supabaseRequest('/auth/v1/logout', { method: 'POST', accessToken });
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) {
        return sendJson(response, 502, { error: 'Não foi possível encerrar a sessão no Supabase.' }, {
          'Set-Cookie': clearSessionCookies(),
        });
      }
    }
    return sendJson(response, 200, { message: 'Sessão encerrada.' }, {
      'Set-Cookie': clearSessionCookies(),
    });
  }

  const auth = await authenticatedUser(request, response);
  if (route === 'GET /api/me') {
    if (!auth) return sendJson(response, 401, { error: 'Faça login para continuar.' });
    const query = new URLSearchParams({
      select: profileFields,
      id: `eq.${auth.user.id}`,
    });
    const profiles = await supabaseRequest(`/rest/v1/profiles?${query}`, { accessToken: auth.accessToken });
    if (!profiles[0]) return sendJson(response, 404, { error: 'Perfil não encontrado.' });
    return sendJson(response, 200, { id: auth.user.id, email: auth.user.email, ...profiles[0] });
  }

  if (route === 'PUT /api/me') {
    if (!auth) return sendJson(response, 401, { error: 'Faça login para continuar.' });
    const input = await readJson(request);
    const profile = normalizeProfile(input);
    const invalidProfile = validateProfile(profile);
    if (invalidProfile) return sendJson(response, 400, { error: invalidProfile });
    if (input.password && (typeof input.password !== 'string' || input.password.length < 6)) {
      return sendJson(response, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' });
    }
    try {
      const updatedProfiles = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(auth.user.id)}`, {
        method: 'PATCH',
        accessToken: auth.accessToken,
        prefer: 'return=representation',
        body: {
          name: profile.name,
          phone: profile.phone,
          birth_date: profile.birth_date,
          postal_code: profile.postal_code,
          street: profile.street,
          district: profile.district,
          city: profile.city,
          state: profile.state,
          number: profile.number,
          complement: profile.complement,
        },
      });
      if (!updatedProfiles?.length) return sendJson(response, 404, { error: 'Perfil não encontrado.' });

      const authUpdates = {};
      if (profile.email !== auth.user.email) authUpdates.email = profile.email;
      if (input.password) authUpdates.password = input.password;
      if (Object.keys(authUpdates).length) {
        await supabaseRequest('/auth/v1/user', {
          method: 'PUT',
          accessToken: auth.accessToken,
          body: authUpdates,
        });
      }
      const message = authUpdates.email
        ? 'Cadastro atualizado. Confirme o novo e-mail pela mensagem enviada pelo Supabase.'
        : 'Cadastro atualizado com sucesso.';
      return sendJson(response, 200, { message });
    } catch (error) {
      if (error.status === 409 || error.status === 422 || error.code === '23505') {
        return sendJson(response, 409, { error: 'Este e-mail já está cadastrado.' });
      }
      if (error.code === '23503') {
        return sendJson(response, 404, { error: 'Perfil não encontrado.' });
      }
      throw error;
    }
  }

  if (route === 'POST /api/password-reset-request') {
    const input = await readJson(request);
    const email = String(input.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(response, 400, { error: 'Informe um e-mail válido.' });
    }
    const redirectUrl = process.env.SUPABASE_RECOVERY_REDIRECT_URL;
    const redirectQuery = redirectUrl ? `?redirect_to=${encodeURIComponent(redirectUrl)}` : '';
    await supabaseRequest(`/auth/v1/recover${redirectQuery}`, {
      method: 'POST',
      body: { email },
    });
    return sendJson(response, 200, { message: 'Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.' });
  }

  if (route === 'POST /api/password-reset') {
    const input = await readJson(request);
    if (typeof input.access_token !== 'string' || !input.access_token) {
      return sendJson(response, 400, { error: 'Link de recuperação inválido ou expirado.' });
    }
    if (typeof input.password !== 'string' || input.password.length < 6) {
      return sendJson(response, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' });
    }
    await supabaseRequest('/auth/v1/user', {
      method: 'PUT',
      accessToken: input.access_token,
      body: { password: input.password },
    });
    return sendJson(response, 200, { message: 'Senha redefinida. Entre com sua nova senha.' });
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
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  pathname = pageAliases.get(normalizedPath) || pathname;
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
    supabaseHeaders();
    server.listen(port, process.env.HOST || '127.0.0.1', () => {
      console.log(`DoeFarmaPet disponível em http://localhost:${port}`);
      console.log(`Supabase: ${supabaseUrl}`);
    });
  } catch (error) {
    console.error(`Não foi possível configurar o Supabase: ${error.message}`);
    process.exitCode = 1;
  }
}

if (!process.env.VERCEL) startServer();
