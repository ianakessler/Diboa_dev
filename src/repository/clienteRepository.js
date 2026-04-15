import pool from '../config/db.js';

/**
 * @typedef {Object} Cliente
 * @property {number} id
 * @property {string} nome
 * @property {string} numero_documento
 * @property {number} client_id
 * @property {number} pontos
 * @property {string} email
 * @property {string} telefone
 * @property {string} endereco
 * @property {string} numero
 * @property {string} complemento
 * @property {string} bairro
 * @property {string} cidade
 * @property {string} estado
 * @property {string} cep
 */

/**
 * Returns all clients with selected fields.
 * @returns {Promise<Cliente[]>}
 */
export async function findAll() {
  const [rows] = await pool.query(
    'SELECT id, nome, numero_documento, pontos, email, telefone, endereco, numero, complemento, bairro, cidade, estado, cep FROM clientes ORDER BY nome ASC'
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
    'SELECT id, nome, numero_documento, client_id, pontos, email, telefone, endereco, numero, complemento, bairro, cidade, estado, cep FROM clientes WHERE numero_documento = ? LIMIT 1',
    [cpf]
  );
  return rows[0] ?? null;
}

/**
 * Inserts a client if it doesn't exist (idempotent).
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {{ nome: string, cpf: string, clienteId: number }} data
 */
export async function upsertIgnore(conn, { nome, cpf, clienteId, email, telefone, endereco, numero, complemento, bairro, cidade, estado, cep }) {
  await conn.query(
    `INSERT IGNORE INTO clientes (nome, numero_documento, client_id, email, telefone, endereco, numero, complemento, bairro, cidade, estado, cep)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nome, cpf, clienteId, email ?? null, telefone ?? null, endereco ?? null, numero ?? null, complemento ?? null, bairro ?? null, cidade ?? null, estado ?? null, cep ?? null]
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
    'SELECT id, client_id, pontos FROM clientes WHERE numero_documento = ? LIMIT 1 FOR UPDATE',
    [cpf]
  );
  return rows[0] ?? null;
}


/**
 * Update a client
 */
export async function updateClient(conn, { id, cpf, pontos, nome, email, telefone, endereco, numero, complemento, bairro, cidade, estado, cep }) {
    await conn.query(
      `UPDATE clientes SET pontos = ?, numero_documento = ?, nome = ?,
       email = ?, telefone = ?, endereco = ?, numero = ?, complemento = ?,
       bairro = ?, cidade = ?, estado = ?, cep = ?
       WHERE id = ?`,
      [pontos, cpf, nome, email ?? null, telefone ?? null, endereco ?? null, numero ?? null, complemento ?? null, bairro ?? null, cidade ?? null, estado ?? null, cep ?? null, id]
    );
} 

export async function deleteClientById(conn, id){
  await conn.query(
    `DELETE FROM clientes WHERE id = ?`,
    [id]
  );
}

export async function insertResgate(conn, cliente_id, pontos) {
  await conn.query(
    `INSERT INTO historico_resgates (cliente_id, pontos_resgatados) values(?, ?)`,
    [cliente_id, pontos]
  );
}

export async function getResgaresById(cliente_id) {
  const [rows] = await pool.query(
    `SELECT data_resgate, pontos_resgatados FROM historico_resgates WHERE cliente_id = ?`,
    [cliente_id]
  );
  return rows;
}