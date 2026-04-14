import { createHmac, timingSafeEqual } from 'node:crypto';
import logger from '../config/logger.js';

export function verifyBlingSignature(req, res, next) {
  const signatureHeader = req.headers['x-bling-signature-256'];

  if (!signatureHeader) {
    logger.warn('Webhook recebido sem header X-Bling-Signature-256', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({ error: 'Assinatura ausente' });
  }

  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientSecret) {
    logger.error('CLIENT_SECRET não configurado no .env');
    return res.status(500).json({ error: 'Configuração interna ausente' });
  }

  const receivedHash = signatureHeader.replace(/^sha256=/, '');

  const expectedHash = createHmac('sha256', clientSecret)
    .update(req.rawBody)
    .digest('hex');

  const receivedBuf = Buffer.from(receivedHash, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');

  if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
    logger.warn('Webhook com assinatura HMAC inválida', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({ error: 'Assinatura inválida' });
  }

  next();
}
