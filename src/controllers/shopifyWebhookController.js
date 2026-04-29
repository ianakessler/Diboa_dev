import pool from '../config/db.js';
import * as cupomRepo from '../repository/cupomRepository.js';
import logger from '../config/logger.js';

export async function handleShopifyOrderWebhook(req, res) {
  res.status(200).json({ received: true });

  try {
    const discountCodes = req.body?.discount_codes || [];

    for (const item of discountCodes) {
      const codigo = item?.code;
      if (!codigo) continue;

      const cupom = await cupomRepo.findByCodigo(codigo);
      if (!cupom) continue;

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await cupomRepo.marcarComoUtilizado(conn, codigo);
        await conn.commit();
        logger.info('Cupom utilizado via webhook Shopify', {
          codigo,
          orderId: req.body?.id,
        });
      } catch (err) {
        await conn.rollback();
        logger.error('Falha ao marcar cupom como utilizado', {
          codigo,
          error: err.message,
        });
      } finally {
        conn.release();
      }
    }
  } catch (err) {
    logger.error('Erro ao processar webhook Shopify orders/create', {
      error: err.message,
      stack: err.stack,
    });
  }
}
