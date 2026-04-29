import {
  verifyInstallHmac,
  buildAuthorizationUrl,
  handleOAuthCallback,
  loadToken,
} from '../services/shopifyAuthService.js';
import { isValidShopDomain } from '../config/shopify.js';
import { BadRequestError } from '../errors/AppError.js';
import logger from '../config/logger.js';

/**
 * GET /api/v1/auth/shopify?shop=loja.myshopify.com
 *
 * Ponto de entrada da instalação. Pode ser chamado:
 *   a) Pelo Shopify (quando o lojista clica "Instalar") — vem com hmac, shop, timestamp
 *   b) Manualmente pelo dev para iniciar o fluxo — vem só com shop
 *
 * Em ambos os casos, redireciona o lojista para a tela de permissões do Shopify.
 */
export async function beginShopifyAuth(req, res, next) {
  try {
    const { shop } = req.query;

    if (!shop || !isValidShopDomain(shop)) {
      throw new BadRequestError(
        'Parâmetro "shop" obrigatório no formato loja.myshopify.com'
      );
    }

    // Se veio do Shopify (com hmac), verificar autenticidade
    if (req.query.hmac) {
      const valid = verifyInstallHmac(req.query);
      if (!valid) {
        logger.warn('Shopify install request com HMAC inválido', { shop });
        throw new BadRequestError('HMAC inválido na request de instalação');
      }
    }

    // Verificar se já temos token (app já instalado)
    const existing = await loadToken(shop);
    if (existing) {
      logger.info('Shopify app já instalado, re-autorizando', { shop });
    }

    // Gerar URL de autorização e redirecionar
    const { url, nonce } = buildAuthorizationUrl(shop);

    logger.info('Shopify OAuth: redirecionando para tela de permissões', {
      shop,
      nonce: nonce.substring(0, 8) + '...',
    });

    return res.redirect(302, url);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/auth/shopify/callback?code=xxx&hmac=yyy&shop=zzz&state=nnn&timestamp=ttt
 *
 * Callback após o lojista aprovar a instalação.
 * O Shopify redireciona para cá com o authorization code.
 *
 * Fluxo:
 *   1. Valida HMAC, nonce (state), shop domain
 *   2. Troca o code por access_token via POST ao Shopify
 *   3. Salva o token no MySQL
 *   4. Redireciona o lojista para uma página de sucesso
 */
export async function shopifyAuthCallback(req, res, next) {
  try {
    const { shop, scope } = await handleOAuthCallback(req.query);

    logger.info('Shopify OAuth concluído com sucesso', { shop, scope });

    // Redirecionar para o admin do Shopify (experiência padrão)
    // Ou para uma página de sucesso da sua API
    return res.status(200).json({
      success: true,
      message: 'App instalado com sucesso!',
      shop,
      scope,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/auth/shopify/status?shop=loja.myshopify.com
 *
 * Endpoint auxiliar para verificar se o app está instalado.
 */
export async function shopifyAuthStatus(req, res, next) {
  try {
    const { shop } = req.query;

    if (!shop || !isValidShopDomain(shop)) {
      throw new BadRequestError('Parâmetro "shop" obrigatório');
    }

    const token = await loadToken(shop);

    return res.status(200).json({
      installed: !!token,
      shop,
      scope: token?.scope ?? null,
    });
  } catch (error) {
    next(error);
  }
}
