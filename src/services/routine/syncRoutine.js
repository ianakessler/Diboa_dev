import { cpf as cpfValidator } from 'cpf-cnpj-validator';
import pool from '../../config/db.js';
import * as clienteRepo from '../../repository/clienteRepository.js';
import * as vendaRepo from '../../repository/vendaRepository.js';
import { fetchPedidosVendas } from './blingApi.js';
import logger from '../../config/logger.js';

/**
 * Filters and maps Bling orders to client upsert data.
 * Only includes orders with a valid CPF.
 */
function extractValidClients(pedidos) {
  return pedidos
    .filter((p) => {
      const doc = p.contato?.numeroDocumento?.replace(/\D/g, '');
      return doc && cpfValidator.isValid(doc);
    })
    .map((p) => ({
      nome: p.contato.nome,
      cpf: p.contato.numeroDocumento.replace(/\D/g, ''),
      clienteId: p.contato.id,
    }));
}

/**
 * Filters and maps Bling orders to venda batch rows.
 * Only includes confirmed orders (situacao.valor == 1) with valid CPF.
 */
function extractValidVendas(pedidos) {
  return pedidos
    .filter((p) => {
      if (p.situacao?.valor !== 1) return false;
      const doc = p.contato?.numeroDocumento?.replace(/\D/g, '');
      return doc && cpfValidator.isValid(doc);
    })
    .map((p) => [
      p.id,
      p.numero,
      p.data,
      p.total,
      p.contato.id,
    ]);
}

/**
 * Full sync routine:
 * 1. Fetch today's orders from Bling
 * 2. Upsert valid clients
 * 3. Batch-insert new sales
 * 4. Process unprocessed sales (award points)
 */
export async function executarRotina() {
  logger.info('Rotina iniciada');

  const response = await fetchPedidosVendas();
  const pedidos = response.data ?? [];

  if (pedidos.length === 0) {
    logger.info('Nenhum pedido retornado pela API');
    return { clientesUpserted: 0, vendasInseridas: 0, vendasProcessadas: 0 };
  }

  const clientesData = extractValidClients(pedidos);
  const vendasData = extractValidVendas(pedidos);

  logger.info('Resumo dos pedidos', {
    total: pedidos.length,
    comCpfValido: clientesData.length,
    vendasConfirmadas: vendasData.length,
  });

  // --- Step 1: Upsert clients ---
  const clientConn = await pool.getConnection();
  try {
    await clientConn.beginTransaction();
    for (const cliente of clientesData) {
      await clienteRepo.upsertIgnore(clientConn, cliente);
    }
    await clientConn.commit();
    logger.info('Clientes sincronizados', { count: clientesData.length });
  } catch (err) {
    await clientConn.rollback();
    throw err;
  } finally {
    clientConn.release();
  }

  // --- Step 2: Insert sales ---
  const vendaConn = await pool.getConnection();
  let vendasInseridas = 0;
  try {
    await vendaConn.beginTransaction();
    const result = await vendaRepo.batchInsertIgnore(vendaConn, vendasData);
    vendasInseridas = result.affectedRows;
    await vendaConn.commit();
    logger.info('Vendas inseridas', { inseridas: vendasInseridas, enviadas: vendasData.length });
  } catch (err) {
    await vendaConn.rollback();
    throw err;
  } finally {
    vendaConn.release();
  }

  // --- Step 3: Process pending sales ---
  const processConn = await pool.getConnection();
  let processResult = { clientesAtualizados: 0, vendasProcessadas: 0 };
  try {
    await processConn.beginTransaction();
    processResult = await vendaRepo.processarVendasPendentes(processConn);
    await processConn.commit();
    logger.info('Pontos distribuídos', processResult);
  } catch (err) {
    await processConn.rollback();
    throw err;
  } finally {
    processConn.release();
  }

  logger.info('Rotina concluída');
  return {
    clientesUpserted: clientesData.length,
    vendasInseridas,
    vendasProcessadas: processResult.vendasProcessadas,
  };
}
