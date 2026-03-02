import pool from '../config/db.js';
import * as clienteRepo from '../repository/clienteRepository.js';
import { validateCpf, validatePontos } from '../validators/index.js';
import { NotFoundError, InsufficientBalanceError } from '../errors/AppError.js';
import logger from '../config/logger.js';

/**
 * Deducts points from a client. Fully transactional with row-level locking.
 * @param {string} rawCpf
 * @param {number} rawPontos
 */
export async function resgatar(rawCpf, rawPontos) {
  const cpf = validateCpf(rawCpf);
  const pontos = validatePontos(rawPontos);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const cliente = await clienteRepo.findByCpfForUpdate(conn, cpf);
    if (!cliente) {
      throw new NotFoundError('Cliente não encontrado');
    }
    if (cliente.pontos < pontos) {
      throw new InsufficientBalanceError(
        `Saldo insuficiente. Disponível: ${cliente.pontos}, solicitado: ${pontos}`
      );
    }

    await clienteRepo.deductPontos(conn, cliente.id, pontos);
    await conn.commit();

    logger.info('Resgate efetuado', { clienteId: cliente.id, pontos });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
