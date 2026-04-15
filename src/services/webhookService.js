import { cpf as cpfValidator } from 'cpf-cnpj-validator';
import pool from '../config/db.js';
import * as clienteRepo from '../repository/clienteRepository.js';
import * as vendaRepo from '../repository/vendaRepository.js';
import { fetchPedidoById, fetchContatoById } from './routine/blingApi.js';
import logger from '../config/logger.js';

export async function processarWebhookVenda(body) {
  const { data } = body;

  if (!data?.id) {
    logger.warn('Webhook ignorado: payload sem data.id', { body });
    return;
  }

  if (data.situacao && data.situacao.valor !== 1) {
    logger.info('Webhook ignorado: situação não confirmada');
    return;
  }

  const pedido = await fetchPedidoById(data.id);

  
    if (pedido.contato.id === 15590339554) {
      logger.info('Webhook ignorado: Consumidor final sem registro');
      return;
    }
  if (pedido.situacao?.valor !== 1) {
    logger.info('Webhook ignorado após consulta: situação não confirmada', {
      pedidoId: pedido.id,
      situacao: pedido.situacao,
    });
    return;
  }

  const contato = await fetchContatoById(pedido.contato.id);

  const doc = contato.numeroDocumento?.replace(/\D/g, '');
  if (!doc || !cpfValidator.isValid(doc)) {
    logger.info('Webhook ignorado: CPF inválido ou ausente', {
      contatoId: contato.id,
    });
    return;
  }

  const enderecoGeral = contato.endereco?.geral ?? {};

  // 7. Salvar no banco (transação)
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await clienteRepo.upsertIgnore(conn, {
      nome: contato.nome,
      cpf: doc,
      clienteId: contato.id,
      email: contato.email ?? null,
      telefone: contato.telefone || contato.celular || null,
      endereco: enderecoGeral.endereco ?? null,
      numero: enderecoGeral.numero ?? null,
      complemento: enderecoGeral.complemento ?? null,
      bairro: enderecoGeral.bairro ?? null,
      cidade: enderecoGeral.municipio ?? null,
      estado: enderecoGeral.uf ?? null,
      cep: enderecoGeral.cep ?? null,
    });

    await vendaRepo.batchInsertIgnore(conn, [[
      pedido.id,
      pedido.numero,
      pedido.data,
      pedido.total,
      contato.id,
    ]]);

    await conn.query(
      `UPDATE clientes c
       JOIN vendas v ON c.client_id = v.cliente_id
       SET c.pontos = c.pontos + v.valor_total
       WHERE v.bling_pedido_id = ? AND v.processada = 0`,
      [pedido.id]
    );

    await conn.query(
      'UPDATE vendas SET processada = 1 WHERE bling_pedido_id = ? AND processada = 0',
      [pedido.id]
    );

    await conn.commit();
    logger.info('Webhook processado com sucesso', {
      nome_cliente: contato.nome,
      total: pedido.total,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
