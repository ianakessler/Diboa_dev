import * as clienteRepo from '../repository/clienteRepository.js';
import { NotFoundError } from '../errors/AppError.js';
import { validateCpf } from '../validators/index.js';

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
