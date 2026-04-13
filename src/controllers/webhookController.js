import { processarWebhookVenda } from '../services/webhookService.js';
import logger from '../config/logger.js';

export async function handleBlingVendaWebhook(req, res) {
  res.status(200).json({ received: true });

  try {
    await processarWebhookVenda(req.body);
  } catch (error) {
    logger.error('Erro ao processar webhook Bling', { error: error.message });
  }
}
