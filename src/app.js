import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import clienteRoutes from './routes/clienteRoutes.js';
import resgateRoutes from './routes/resgateRoutes.js';
import authRoutes from './routes/authRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import logger from './config/logger.js';
import pool from './config/db.js';
import { executarRotina } from './services/routine/syncRoutine.js';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT ?? 9292;

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({
  verify: (req, _res, buf) => {
    if (req.originalUrl?.startsWith('/api/v1/webhooks')) {
      req.rawBody = buf;
    }
  },
}));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, try again later' },
  skip: (req) => req.originalUrl?.startsWith('/api/v1/webhooks'),
}));

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use('/api/v1', clienteRoutes);
app.use('/api/v1', resgateRoutes);
app.use('/api/v1', authRoutes);
app.use('/api/v1', webhookRoutes);

// ── check bling signature ────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.includes('webhooks') && !req.path.startsWith('/api/v1')) {
    logger.warn('Webhook em path incorreto', {
      path: req.originalUrl,
      ip: req.ip,
      headers: {
        'x-bling-signature-256': req.headers['x-bling-signature-256'] ?? 'AUSENTE',
        'user-agent': req.headers['user-agent'],
      },
    });
  }
  next();
});

// ── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
});

// ── Global Error Handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, { env: process.env.NODE_ENV ?? 'development' });
});

// ── Cron: rotina diária de sincronização (23:59) ─────────────────────────────
cron.schedule('55 23 * * *', async () => {
  logger.info('Cron: iniciando rotina diaria de sincronizacao');
  try {
    const result = await executarRotina();
    logger.info('Cron: rotina concluida', result);
  } catch (err) {
    logger.error('Cron: erro na rotina', { error: err.message });
  }
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await pool.end();
    logger.info('MySQL pool closed. Process exiting.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
