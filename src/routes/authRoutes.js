import { Router } from 'express';
import { authBling, authBlingCallback } from '../controllers/authController.js';

const router = Router();

router.get('/auth/bling', authBling);
router.get('/auth/bling/callback', authBlingCallback);

export default router;
