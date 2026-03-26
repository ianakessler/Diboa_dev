import 'dotenv/config';
import express from 'express';
import clienteRoutes from './routes/clienteRoutes.js';
import resgateRoutes from './routes/resgateRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import logger from './config/logger.js';
import cors from 'cors';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
} from './services/routine/blingAuth.js';

const app = express();
const PORT = process.env.PORT ?? 3000;

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cors({origin: "*"}));
// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/bling/auth', (_req, res) => {
  const redirectUri = process.env.BLING_REDIRECT_URI; // ex: http://localhost:3000/bling/callback
  const url = getAuthorizationUrl(redirectUri);
  res.redirect(url);
});
app.get('/bling/callback', async (req, res, next) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Código OAuth ausente');
    const redirectUri = process.env.BLING_REDIRECT_URI;
    await exchangeCodeForTokens(code, redirectUri);
    res.send('✅ Tokens salvos com sucesso! Você pode remover estas rotas agora.');
  } catch (err) {
    next(err);
  }
});
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use('/api/v1', clienteRoutes);
app.use('/api/v1', resgateRoutes);

// ── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
});

// ── Global Error Handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, { env: process.env.NODE_ENV ?? 'development' });
});

export default app;

