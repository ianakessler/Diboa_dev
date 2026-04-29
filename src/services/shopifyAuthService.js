import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import pool from '../config/db.js';
import logger from '../config/logger.js';
import {
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  SHOPIFY_SCOPES,
  SHOPIFY_REDIRECT_URI,
  isValidShopDomain,
} from '../config/shopify.js';
import { AppError, BadRequestError } from '../errors/AppError.js';

// ─── Nonce store (em memória — funciona para single-instance) ────────────────
// Para multi-instance, migre para Redis ou tabela MySQL.
const nonceStore = new Map();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 min

function generateNonce() {
  const nonce = randomBytes(16).toString('hex');
  nonceStore.set(nonce, Date.now());
  return nonce;
}

function consumeNonce(nonce) {
  const created = nonceStore.get(nonce);
  if (!created) return false;
  nonceStore.delete(nonce);
  if (Date.now() - created > NONCE_TTL_MS) return false;
  return true;
}

// Limpar nonces expirados a cada 10min
setInterval(() => {
  const now = Date.now();
  for (const [nonce, ts] of nonceStore) {
    if (now - ts > NONCE_TTL_MS) nonceStore.delete(nonce);
  }
}, 10 * 60 * 1000);

// ─── Step 1 & 2: Verificar request e gerar URL de autorização ────────────────

/**
 * Verifica o HMAC do request de instalação enviado pelo Shopify.
 * @param {Record<string,string>} query — req.query inteiro
 * @returns {boolean}
 */
export function verifyInstallHmac(query) {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  // Ordenar parâmetros alfabeticamente e montar query string
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');

  const digest = createHmac('sha256', SHOPIFY_CLIENT_SECRET)
    .update(message)
    .digest('hex');

  try {
    return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Constrói a URL de autorização do Shopify.
 * @param {string} shop — ex: "diboatabacaria.myshopify.com"
 * @returns {{ url: string, nonce: string }}
 */
export function buildAuthorizationUrl(shop) {
  if (!isValidShopDomain(shop)) {
    throw new BadRequestError('Domínio de loja inválido');
  }

  const nonce = generateNonce();

  const params = new URLSearchParams({
    client_id: SHOPIFY_CLIENT_ID,
    scope: SHOPIFY_SCOPES,
    redirect_uri: SHOPIFY_REDIRECT_URI,
    state: nonce,
  });

  const url = `https://${shop}/admin/oauth/authorize?${params}`;
  return { url, nonce };
}

// ─── Step 3 & 4: Validar callback e trocar code por access token ─────────────

/**
 * Valida todos os parâmetros do callback OAuth do Shopify.
 * @param {Record<string,string>} query — req.query do callback
 * @throws {BadRequestError|AppError}
 */
export function validateCallback(query) {
  const { shop, hmac, code, state, timestamp } = query;

  // 1. Shop válido
  if (!isValidShopDomain(shop)) {
    throw new BadRequestError('Domínio de loja inválido no callback');
  }

  // 2. Code presente
  if (!code) {
    throw new BadRequestError('Parâmetro "code" ausente no callback');
  }

  // 3. Nonce/state bate com o que geramos
  if (!consumeNonce(state)) {
    throw new AppError('State inválido ou expirado (possível CSRF)', 403, 'INVALID_STATE');
  }

  // 4. HMAC válido
  if (!verifyInstallHmac(query)) {
    throw new AppError('HMAC do callback inválido', 403, 'INVALID_HMAC');
  }

  // 5. Timestamp razoável (não mais de 5 min atrás)
  if (timestamp) {
    const age = Math.floor(Date.now() / 1000) - Number(timestamp);
    if (age > 300) {
      throw new AppError('Request expirado (timestamp muito antigo)', 403, 'EXPIRED_REQUEST');
    }
  }
}

/**
 * Troca o authorization code por um access token offline.
 *
 * POST https://{shop}/admin/oauth/access_token
 * Body: { client_id, client_secret, code }
 * Response: { access_token, scope }
 *
 * @param {string} shop
 * @param {string} code
 * @returns {Promise<{ accessToken: string, scope: string }>}
 */
export async function exchangeCodeForToken(shop, code) {
  const url = `https://${shop}/admin/oauth/access_token`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('Shopify OAuth token exchange falhou', {
      status: response.status,
      body,
    });
    throw new AppError(
      `Erro ao trocar code por token: ${response.status}`,
      502,
      'SHOPIFY_TOKEN_ERROR'
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new AppError('Resposta do Shopify sem access_token', 502, 'SHOPIFY_TOKEN_ERROR');
  }

  logger.info('Shopify: access token obtido com sucesso', {
    shop,
    scope: data.scope,
  });

  return {
    accessToken: data.access_token,
    scope: data.scope,
  };
}

// ─── Persistência dos tokens no MySQL ────────────────────────────────────────

/**
 * Salva (ou atualiza) o token Shopify no banco.
 *
 * Tabela esperada:
 *   CREATE TABLE shopify_tokens (
 *     id INT AUTO_INCREMENT PRIMARY KEY,
 *     shop VARCHAR(255) UNIQUE NOT NULL,
 *     access_token VARCHAR(500) NOT NULL,
 *     scope TEXT,
 *     installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 *     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 *   );
 */
export async function saveToken(shop, accessToken, scope) {
  await pool.query(
    `INSERT INTO shopify_tokens (shop, access_token, scope)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       scope        = VALUES(scope),
       updated_at   = CURRENT_TIMESTAMP`,
    [shop, accessToken, scope]
  );
  logger.info('Shopify token salvo no banco', { shop });
}

/**
 * Carrega o token salvo para uma loja.
 * @param {string} shop
 * @returns {Promise<{ accessToken: string, scope: string } | null>}
 */
export async function loadToken(shop) {
  const [rows] = await pool.query(
    'SELECT access_token, scope FROM shopify_tokens WHERE shop = ? LIMIT 1',
    [shop]
  );
  if (!rows[0]) return null;
  return { accessToken: rows[0].access_token, scope: rows[0].scope };
}

// ─── Fluxo completo orquestrado ──────────────────────────────────────────────

/**
 * Passo final: valida callback, troca code, salva token.
 * @param {Record<string,string>} query
 * @returns {Promise<{ shop: string, scope: string }>}
 */
export async function handleOAuthCallback(query) {
  // Valida tudo (lança erro se inválido)
  validateCallback(query);

  const { shop, code } = query;

  // Troca code por token
  const { accessToken, scope } = await exchangeCodeForToken(shop, code);

  // Persiste
  await saveToken(shop, accessToken, scope);

  return { shop, scope };
}
