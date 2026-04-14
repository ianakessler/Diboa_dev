import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyBlingSignature } from '../middleware/blingSignature.js';
import { handleBlingVendaWebhook } from '../controllers/webhookController.js';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many webhook requests' },
});

router.post('/webhooks/bling/vendas', webhookLimiter, verifyBlingSignature, handleBlingVendaWebhook);

export default router;
