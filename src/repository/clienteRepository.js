import pool from '../config/db.js';

/**
 * @typedef {Object} Cliente
 * @property {number} id
 * @property {string} nome
 * @property {string} cpf
 * @property {number} pontos
 */

/**
 * Returns all clients with selected fields.
 * @returns {Promise<Cliente[]>}
 */
export async function findAll() {
  const [rows] = await pool.query(
    'SELECT id, nome, cpf, pontos FROM clientes ORDER BY nome ASC'
  );
  return rows;
}

/**
 * Returns a single client by CPF (digits only).
 * @param {string} cpf
 * @returns {Promise<Cliente|null>}
 */
export async function findByCpf(cpf) {
  const [rows] = await pool.query(
    'SELECT id, nome, cpf, pontos FROM clientes WHERE cpf = ? LIMIT 1',
    [cpf]
  );
  return rows[0] ?? null;
}

/**
 * Inserts a client if it doesn't exist (idempotent).
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {{ nome: string, cpf: string, clienteId: number }} data
 */
export async function upsertIgnore(conn, { nome, cpf, clienteId }) {
  await conn.query(
    'INSERT IGNORE INTO clientes (nome, cpf, client_id) VALUES (?, ?, ?)',
    [nome, cpf, clienteId]
  );
}

/**
 * Deducts points from a client within a given connection (use inside a transaction).
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} id
 * @param {number} pontos
 */
export async function deductPontos(conn, id, pontos) {
  await conn.query(
    'UPDATE clientes SET pontos = pontos - ? WHERE id = ?',
    [pontos, id]
  );
}

/**
 * Locks and returns a client row for update (must be inside a transaction).
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {string} cpf
 * @returns {Promise<Cliente|null>}
 */
export async function findByCpfForUpdate(conn, cpf) {
  const [rows] = await conn.query(
    'SELECT id, pontos FROM clientes WHERE cpf = ? LIMIT 1 FOR UPDATE',
    [cpf]
  );
  return rows[0] ?? null;
}


/**
 * Update a client
 */
export async function updateClient(conn, cpf, pontos, nome, id) {
    await conn.query(
      `UPDATE clientes SET pontos = ?, cpf = ?,
      nome = ? WHERE id = ?`,
      [pontos, cpf, nome, id]
    );
} 

export async function deleteClientById(conn, id){
  await conn.query(
    `DELETE FROM clientes WHERE id = ?`,
    [id]
  );
}

export async function insertResgate(conn, cliente_id, pontos) {
  try{
    await conn.query(
      `INSERT INTO historico_resgates cliente_id = ? pontos = ?`,
      [cliente_id, pontos]
    );
  } catch (error) {
    throw error;
  }
}

export async function getResgaresById(conn, cliente_id) {

  await conn.query(
    `SELECT data_resgate, pontos_resgatados FROM historico_resgates WHERE cliente_id = ?`,
    [cliente_id]
  );
}