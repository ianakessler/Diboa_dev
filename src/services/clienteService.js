import * as clienteRepo from '../repository/clienteRepository.js';
import { NotFoundError } from '../errors/AppError.js';
import { validateCpf } from '../validators/index.js';
import pool from '../config/db.js';

/**
 * Returns all clients.
 * @returns {Promise<import('../repository/clienteRepository.js').Cliente[]>}
 */
export async function getAll() {
  return clienteRepo.findAll();
}

/**
 * Returns a client by CPF. Throws NotFoundError if not found.
 * @param {string} rawCpf
 */
export async function getByCpf(rawCpf) {
  const cpf = validateCpf(rawCpf);
  const client = await clienteRepo.findByCpf(cpf);
  if (!client) throw new NotFoundError('Cliente não encontrado');
  return client;
}

/**
 * Edit a single client using CPF 
 * @param {string} rawCpf
 * @param {number} pontos
 * @param {string} nome
 */
export async function editByCpf(rawCpf, pontos, nome) {

  const cpf = validateCpf(rawCpf);
  const conn = await conn.getConnection();
  try {
    await pool.beginTransaction();
    const cliente = await clienteRepo.findByCpfForUpdate(conn, cpf);
    if (!cliente)
    {
      await conn.rollback();
      throw new NotFoundError('Cliente não encontrado');
    }
    await clienteRepo.updateClient(conn, cpf, pontos, nome, cliente.id);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally
  {
    conn.release();
  }
}