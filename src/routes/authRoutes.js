import { Router } from 'express';
import { authBling, authBlingCallback, getValidToken } from '../controllers/authController.js';
import {
  beginShopifyAuth,
  shopifyAuthCallback,
  shopifyAuthStatus,
} from '../controllers/shopifyAuthController.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';

const router = Router();

// ── Bling OAuth ──────────────────────────────────────────────────────────────
router.get('/auth/bling', authBling);
router.get('/auth/bling/callback', authBlingCallback);
router.get('/validToken', requireApiKey, getValidToken);

// ── Shopify OAuth (Authorization Code Grant) ─────────────────────────────────
router.get('/auth/shopify', beginShopifyAuth);
router.get('/auth/shopify/callback', shopifyAuthCallback);
router.get('/auth/shopify/status', shopifyAuthStatus);

export default router;
