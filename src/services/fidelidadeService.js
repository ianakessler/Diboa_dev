import pool from '../config/db.js';
import { CONFIG_FIDELIDADE } from '../config/fidelidade.js';
import * as clienteRepo from '../repository/clienteRepository.js';
import * as cupomRepo from '../repository/cupomRepository.js';
import { criarCupomDesconto } from './shopifyDiscountService.js';
import { validateCpf, validatePontos } from '../validators/index.js';
import {
  NotFoundError,
  InsufficientBalanceError,
  BadRequestError,
} from '../errors/AppError.js';
import logger from '../config/logger.js';

export { CONFIG_FIDELIDADE };

export async function consultarSaldo(rawCpf) {
  const cpf = validateCpf(rawCpf);

  const cliente = await clienteRepo.findByCpf(cpf);
  if (!cliente) throw new NotFoundError('Cliente não encontrado');

  const opcoesDisponiveis = CONFIG_FIDELIDADE.OPCOES_RESGATE.filter(
    (o) => o.pontos <= cliente.pontos
  );

  const cuponsAtivos = await cupomRepo.findAtivosByClienteId(cliente.id);

  return {
    cliente: {
      nome: cliente.nome,
      pontos: cliente.pontos,
      cpf: cliente.numero_documento,
    },
    opcoesDisponiveis,
    cuponsAtivos,
  };
}

export async function resgatarPontos(rawCpf, rawPontos) {
  const cpf = validateCpf(rawCpf);
  const pontos = validatePontos(rawPontos);

  const opcao = CONFIG_FIDELIDADE.OPCOES_RESGATE.find((o) => o.pontos === pontos);
  if (!opcao) throw new BadRequestError('Opção de resgate inválida');
  const valorDesconto = opcao.valor;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const cliente = await clienteRepo.findByCpfForUpdate(conn, cpf);
    if (!cliente) throw new NotFoundError('Cliente não encontrado');
    if (cliente.pontos < pontos) {
      throw new InsufficientBalanceError(
        `Saldo insuficiente. Disponível: ${cliente.pontos}, solicitado: ${pontos}`
      );
    }

    await clienteRepo.deductPontos(conn, cliente.id, pontos);
    await clienteRepo.insertResgate(conn, cliente.client_id, pontos);

    const cupomShopify = await criarCupomDesconto({
      shop: CONFIG_FIDELIDADE.SHOP,
      titulo: `Resgate Fidelidade - ${pontos}pts - R$${valorDesconto}`,
      valorDesconto,
      diasExpiracao: CONFIG_FIDELIDADE.DIAS_EXPIRACAO,
    });

    try {
      await cupomRepo.insertCupom(conn, {
        clienteId: cliente.id,
        cpf,
        pontosResgatados: pontos,
        valorDesconto,
        codigoCupom: cupomShopify.codigoCupom,
        shopifyDiscountId: cupomShopify.shopifyDiscountId,
        expiraEm: cupomShopify.endsAt,
      });
    } catch (insertErr) {
      logger.error(
        'Cupom criado no Shopify mas falhou ao registrar no banco — limpeza manual necessária',
        {
          shop: CONFIG_FIDELIDADE.SHOP,
          codigoCupom: cupomShopify.codigoCupom,
          shopifyDiscountId: cupomShopify.shopifyDiscountId,
          clienteId: cliente.id,
          cpf,
          pontos,
          error: insertErr.message,
        }
      );
      throw insertErr;
    }

    await conn.commit();

    logger.info('Resgate concluído com cupom Shopify', {
      clienteId: cliente.id,
      pontos,
      valorDesconto,
      codigoCupom: cupomShopify.codigoCupom,
    });

    return {
      codigoCupom: cupomShopify.codigoCupom,
      valorDesconto,
      expiraEm: cupomShopify.endsAt,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
