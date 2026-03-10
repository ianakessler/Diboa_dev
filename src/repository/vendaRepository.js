import pool from '../config/db.js';

/**
 * @typedef {Object} Venda
 * @property {number} id
 * @property {string} numero_pedido
 * @property {string} data_venda
 * @property {number} valor_total
 * @property {number} cliente_id
 */

/**
 * Returns all sales for a given client id.
 * @param {number} clienteId
 * @returns {Promise<Venda[]>}
 */
export async function findByClienteId(clienteId) {
  console.log("Cliente_id recebdio = ", clienteId);
  const [rows] = await pool.query(
    'SELECT numero_pedido, data_venda, valor_total FROM vendas WHERE cliente_id = ?',
    [clienteId]
  );
  return rows;
}

/**
 * Batch-inserts sales, ignoring duplicates (idempotent).
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {Array<[number, string, string, number, number]>} values
 */
export async function batchInsertIgnore(conn, values) {
  if (values.length === 0) return { affectedRows: 0 };
  const [result] = await conn.query(
    `INSERT IGNORE INTO vendas
     (bling_pedido_id, numero_pedido, data_venda, valor_total, cliente_id)
     VALUES ?`,
    [values]
  );
  return result;
}

/**
 * Updates points for all clients with unprocessed sales and marks them as processed.
 * Uses a single UPDATE JOIN for performance. Must be inside a transaction.
 * @param {import('mysql2/promise').PoolConnection} conn
 * @returns {Promise<{ clientesAtualizados: number, vendasProcessadas: number }>}
 */
export async function processarVendasPendentes(conn) {
  const [pendentes] = await conn.query(
    'SELECT COUNT(*) AS total FROM vendas WHERE processada = 0'
  );

  if (pendentes[0].total === 0) {
    return { clientesAtualizados: 0, vendasProcessadas: 0 };
  }

  const [resultPontos] = await conn.query(
    `UPDATE clientes c
     JOIN (
       SELECT cliente_id, SUM(valor_total) AS total_pontos
       FROM vendas
       WHERE processada = 0
       GROUP BY cliente_id
     ) v ON c.client_id = v.cliente_id
     SET c.pontos = c.pontos + v.total_pontos`
  );

  const [resultVendas] = await conn.query(
    'UPDATE vendas SET processada = 1 WHERE processada = 0'
  );

  return {
    clientesAtualizados: resultPontos.affectedRows,
    vendasProcessadas: resultVendas.affectedRows,
  };
}
