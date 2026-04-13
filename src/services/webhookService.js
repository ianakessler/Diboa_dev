import { cpf as cpfValidator } from 'cpf-cnpj-validator';
import pool from '../config/db.js';
import * as clienteRepo from '../repository/clienteRepository.js';
import * as vendaRepo from '../repository/vendaRepository.js';
import logger from '../config/logger.js';

export async function processarWebhookVenda(body) {
  const { dados } = body;

  if (dados?.situacao?.valor !== 1) return;

  const doc = dados.contato?.numeroDocumento?.replace(/\D/g, '');
  if (!doc || !cpfValidator.isValid(doc)) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await clienteRepo.upsertIgnore(conn, {
      nome: dados.contato.nome,
      cpf: doc,
      clienteId: dados.contato.id,
    });

    await vendaRepo.batchInsertIgnore(conn, [[
      dados.id,
      dados.numero,
      dados.data,
      dados.total,
      dados.contato.id,
    ]]);

    await conn.query(
      `UPDATE clientes c
       JOIN vendas v ON c.client_id = v.cliente_id
       SET c.pontos = c.pontos + v.valor_total
       WHERE v.bling_pedido_id = ? AND v.processada = 0`,
      [dados.id]
    );

    await conn.query(
      'UPDATE vendas SET processada = 1 WHERE bling_pedido_id = ? AND processada = 0',
      [dados.id]
    );

    await conn.commit();
    logger.info('Webhook processado', { pedidoId: dados.id, cpf: doc });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
