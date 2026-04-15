import * as clienteRepo from '../repository/clienteRepository.js';
import { NotFoundError } from '../errors/AppError.js';
import { validateCpf } from '../validators/index.js';
import pool from '../config/db.js';
import * as vendasRepo from '../repository/vendaRepository.js';

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
export async function editByCpf(rawCpf, { pontos, nome, email, telefone, endereco, numero, complemento, bairro, cidade, estado, cep } = {}) {

  const cpf = validateCpf(rawCpf);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const cliente = await clienteRepo.findByCpfForUpdate(conn, cpf);
    if (!cliente)
    {
      await conn.rollback();
      throw new NotFoundError('Cliente não encontrado');
    }
    await clienteRepo.updateClient(conn, { id: cliente.id, cpf, pontos, nome, email, telefone, endereco, numero, complemento, bairro, cidade, estado, cep });
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally
  {
    conn.release();
  }
}

export async function deleteByCpf(rawCpf)
{
  const cpf =  validateCpf(rawCpf);
  const conn = await pool.getConnection();
  try{
    await conn.beginTransaction();
    const client = await clienteRepo.findByCpfForUpdate(conn, cpf);
    if (!client) {
      await conn.rollback();
      throw new NotFoundError('Cliente não encontrado');
    }
    await clienteRepo.deleteClientById(conn, client.id);
    await conn.commit();
  } catch (error){
    await conn.rollback();
    throw error;
  }
  finally{
    conn.release();
  }
}

export async function montarHistorico(rawCpf) {
  const cpf = validateCpf(rawCpf);
  const client = await clienteRepo.findByCpf(cpf);
  if (!client) throw new NotFoundError('Cliente não encontrado');
  const historico = await clienteRepo.getResgaresById(client.client_id);
  return { client, historico };
}

export async function getHistory(rawCpf) {
  const cpf = validateCpf(rawCpf);
  const client = await clienteRepo.findByCpf(cpf);
  if (!client) throw new NotFoundError('Cliente não encontrado');
  const historico_vendas = await vendasRepo.findByClienteId(client.client_id);
  return { client, historico_vendas };
}

