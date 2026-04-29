import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyBlingSignature } from '../middleware/blingSignature.js';
import { verifyShopifyWebhook } from '../middleware/shopifySignature.js';
import { handleBlingVendaWebhook } from '../controllers/webhookController.js';
import { handleShopifyOrderWebhook } from '../controllers/shopifyWebhookController.js';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many webhook requests' },
});

// ── Bling Webhooks ───────────────────────────────────────────────────────────
router.post('/webhooks/bling/vendas', webhookLimiter, verifyBlingSignature, handleBlingVendaWebhook);

// ── Shopify Webhooks ─────────────────────────────────────────────────────────
router.post('/webhooks/shopify/orders', webhookLimiter, verifyShopifyWebhook, handleShopifyOrderWebhook);

export default router;
