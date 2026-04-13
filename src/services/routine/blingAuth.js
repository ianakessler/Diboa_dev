import pool from '../../config/db.js';
import logger from '../../config/logger.js';
const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token';
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

function getCredentials() {
    const client_id = process.env.CLIENT_ID;
    const client_secret = process.env.CLIENT_SECRET;
    if (!client_id || !client_secret)
        throw new Error('BLING CLIENT ID AND CLIENT SECRET NEDEED!');
    return { client_id, client_secret };
}

function basicAuthHeader() {
    const { client_id, client_secret } = getCredentials();
    return 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64');
}

async function loadTokensFromDB() {
    const [rows] = await pool.query(
        'SELECT * FROM bling_tokens WHERE id = 1 LIMIT 1'
    );
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
    logger.info('Bling tokens salvos no banco', {
    expiresAt: new Date(expiresAt).toISOString(),
    });
}

export async function exchangeCodeForTokens(code, redirectUri) {

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
    });

    const response = await fetch(BLING_TOKEN_URL, {
        method: 'POST',
        headers: {
            Authorization: basicAuthHeader(),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body,
    });

    if (!response.ok) {
        const text = await response.text().catch(()=> '');
        throw new Error(`Bling OAuth error ${response.status}: ${text}`);
    }

    const data = await response.json();
    await saveTokensToDB({
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        expiresIn:    data.expires_in,
    });

    logger.info('Bling: troca de código por tokens concluída');
    return data;
}

async function refreshAccessToken(currentRefreshToken) {
    logger.info("Bling: renovando access_token via refresh_token");

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentRefreshToken
    });

    const response = await fetch(BLING_TOKEN_URL,{
        method: 'POST',
        headers: {
            Authorization: basicAuthHeader(),
            'Content-type': 'application/x-www-form-urlencoded'
        },
        body
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Bling refresh token error ${response.status}: ${text}`);
    }

    const data = await response.json();
    await saveTokensToDB({
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        expiresIn:    data.expires_in,
    });

    logger.info('Bling: access_token renovado com sucesso');
    return data.access_token;
}

export async function getValidAccessToken() {
    const record = await loadTokensFromDB();

    if (!record) {
        throw new Error(
            'Nenhum token Bling encontrado no banco. ' +
            'Execute o fluxo OAuth inicial com exchangeCodeForTokens().'
        );
    }

    const isExpired = Date.now() >= record.expires_at - EXPIRY_MARGIN_MS;

    if (!isExpired) return record.access_token;
    
    return refreshAccessToken(record.refresh_token)
}

export function getAuthorizationUrl(redirectUri, state) {
    const { client_id } = getCredentials();

    if (!state) {
        state = 'state_' + Math.random().toString(36).substring(7) + '_' + Date.now();
    }

    const params = new URLSearchParams({
        response_type: 'code',
        client_id:     client_id,
        redirect_uri:  redirectUri,
        ...(state ? { state } : {}),
    });
    return `https://www.bling.com.br/Api/v3/oauth/authorize?${params}`;
}