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
export async function editByCpf(rawCpf, pontos, nome) {

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

export async function deleteByCpf(rawCpf)
{
  const cpf =  validateCpf(rawCpf);
  const conn = await pool.getConnection();
  try{
    await conn.beginTransaction();
    console.log(`[DEBUG 2] req.body: cpf == ${cpf}`);
    const client = await clienteRepo.findByCpf(cpf);
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
  try{
      const client = await clienteRepo.findByCpf(cpf);
      const historico = await clienteRepo.getResgaresById(client.client_id);
      return {client, historico};
    } catch (error)
    {
      throw error;
    }
}

export async function getHistory(rawCpf) {
  const cpf = validateCpf(rawCpf);
  try{
    const client = await clienteRepo.findByCpf(cpf);
    const historico_vendas =  await vendasRepo.findByClienteId(client.client_id);
    return {client, historico_vendas};
  } catch (error){
    throw error;
  }
}

export async function updateClientInfos(rawCpf) {
  const cpf = validateCpf(rawCpf);
  const BASEURL = 'https://api.bling.com.br/Api/v3';
  try{
    const client = await clienteRepo.findByCpf(cpf);
    const response = await 
  }
}