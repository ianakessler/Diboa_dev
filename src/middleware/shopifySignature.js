import { createHmac, timingSafeEqual } from 'node:crypto';
import logger from '../config/logger.js';

/**
 * Middleware que verifica a assinatura HMAC dos webhooks do Shopify.
 *
 * ATENÇÃO: A verificação de webhooks do Shopify é DIFERENTE da verificação OAuth:
 *   - OAuth:    HMAC-SHA256 hex dos query params, usando CLIENT_SECRET
 *   - Webhooks: HMAC-SHA256 base64 do body raw, usando CLIENT_SECRET
 *
 * Header: X-Shopify-Hmac-Sha256 (base64)
 * Requer que req.rawBody esteja preenchido (já configurado no app.js).
 */
export function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];

  if (!hmacHeader) {
    logger.warn('Webhook Shopify recebido sem header X-Shopify-Hmac-Sha256', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({ error: 'Assinatura ausente' });
  }

  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) {
    logger.error('SHOPIFY_CLIENT_SECRET não configurado no .env');
    return res.status(500).json({ error: 'Configuração interna ausente' });
  }

  // Shopify envia o hash em base64
  const expectedHash = createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('base64');

  try {
    const valid = timingSafeEqual(
      Buffer.from(hmacHeader, 'base64'),
      Buffer.from(expectedHash, 'base64')
    );

    if (!valid) {
      logger.warn('Webhook Shopify com HMAC inválido', { ip: req.ip });
      return res.status(401).json({ error: 'Assinatura inválida' });
    }
  } catch {
    logger.warn('Webhook Shopify: erro na comparação HMAC', { ip: req.ip });
    return res.status(401).json({ error: 'Assinatura inválida' });
  }

  next();
}
