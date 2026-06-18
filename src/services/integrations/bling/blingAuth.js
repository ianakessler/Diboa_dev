import pool from '../../../config/db.js';
import logger from '../../../config/logger.js';
import { AppError } from '../../../errors/AppError.js';

// Host do endpoint de token historicamente é www.bling.com.br; mantemos
// configurável por env (ver brief §9.1).
const TOKEN_URL = process.env.BLING_TOKEN_URL ?? 'https://www.bling.com.br/Api/v3/oauth/token';
const AUTHORIZE_URL = process.env.BLING_AUTHORIZE_URL ?? 'https://www.bling.com.br/Api/v3/oauth/authorize';

const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

// Header obrigatório para receber/usar JWT. Sem ele o Bling devolve token
// opaco (descontinuado). Deve ir na troca de código E no refresh.
const JWT_HEADER = { 'enable-jwt': '1' };

function getCredentials() {
  const client_id = process.env.CLIENT_ID;
  const client_secret = process.env.CLIENT_SECRET;
  if (!client_id || !client_secret) {
    throw new AppError('Bling: CLIENT_ID e CLIENT_SECRET são obrigatórios', 500, 'BLING_MISSING_CREDENTIALS');
  }
  return { client_id, client_secret };
}

function basicAuthHeader() {
  const { client_id, client_secret } = getCredentials();
  return 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64');
}

async function loadTokensFromDB() {
  const [rows] = await pool.query('SELECT * FROM bling_tokens WHERE id = 1 LIMIT 1');
  return rows[0] ?? null;
}

async function saveTokensToDB({ accessToken, refreshToken, expiresIn }) {
  const expiresAt = Date.now() + expiresIn * 1000;
  await pool.query(
    `
    INSERT INTO bling_tokens (id, access_token, refresh_token, expires_at)
    VALUES (1, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      access_token  = VALUES(access_token),
      refresh_token = VALUES(refresh_token),
      expires_at    = VALUES(expires_at)
    `,
    [accessToken, refreshToken, expiresAt]
  );
  logger.info('Bling: tokens salvos no banco', {
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

async function requestToken(body) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...JWT_HEADER,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AppError(`Bling OAuth error ${response.status}: ${text}`, 502, 'BLING_OAUTH_ERROR');
  }

  return response.json();
}

export async function exchangeCodeForTokens(code, redirectUri) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const data = await requestToken(body);
  await saveTokensToDB({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  });

  logger.info('Bling: troca de código por tokens concluída');
  return data;
}

async function refreshAccessToken(currentRefreshToken) {
  logger.info('Bling: renovando access_token via refresh_token');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  });

  const data = await requestToken(body);
  const expiresAt = Date.now() + data.expires_in * 1000;
  await saveTokensToDB({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  });

  logger.info('Bling: access_token renovado com sucesso');
  return { accessToken: data.access_token, expiresAt };
}

/**
 * Retorna um access_token válido, renovando-o se estiver expirado (ou prestes
 * a expirar). Passe { forceRefresh: true } para forçar a renovação — usado
 * pelo retry de 401 no blingApi.
 *
 * @returns {Promise<{ accessToken: string, expiresAt: string }>} token válido e
 *   o horário de expiração em UTC (ISO 8601).
 */
export async function getValidAccessToken({ forceRefresh = false } = {}) {
  const record = await loadTokensFromDB();

  if (!record) {
    throw new AppError(
      'Nenhum token Bling encontrado no banco. Execute o fluxo OAuth inicial.',
      500,
      'BLING_NO_TOKEN'
    );
  }

  const isExpired = Date.now() >= Number(record.expires_at) - EXPIRY_MARGIN_MS;

  if (!forceRefresh && !isExpired) {
    return {
      accessToken: record.access_token,
      expiresAt: new Date(Number(record.expires_at)).toISOString(),
    };
  }

  const { accessToken, expiresAt } = await refreshAccessToken(record.refresh_token);
  return { accessToken, expiresAt: new Date(expiresAt).toISOString() };
}

export function getAuthorizationUrl(redirectUri, state) {
  const { client_id } = getCredentials();

  if (!state) {
    state = 'state_' + Math.random().toString(36).substring(7) + '_' + Date.now();
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}
