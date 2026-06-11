import { getValidAccessToken } from './blingAuth.js';
import logger from '../../../config/logger.js';
import { AppError } from '../../../errors/AppError.js';

const BASE_URL = process.env.BLING_API_BASE_URL ?? 'https://api.bling.com.br/Api/v3';

// Paginação do Bling: limite default 100. Trava de segurança para não loopar.
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Wrapper genérico para chamadas autenticadas ao Bling.
 * Obtém o token válido antes de cada requisição e mantém `enable-jwt: 1` em
 * todas as chamadas (recomendação oficial). Em 401, renova o token e repete
 * a chamada uma única vez.
 */
export async function blingFetch(path, options = {}, { _retry = false } = {}) {
  const token = await getValidAccessToken({ forceRefresh: _retry });

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'enable-jwt': '1',
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 401 && !_retry) {
    logger.warn('Bling API 401: renovando token e repetindo requisição', { path });
    return blingFetch(path, options, { _retry: true });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AppError(`Bling API error ${response.status}: ${body}`, 502, 'BLING_API_ERROR');
  }

  return response.json();
}

/**
 * Busca um pedido de venda pelo ID.
 * @param {number|string} pedidoId
 * @returns {Promise<Object>} dados completos do pedido
 */
export async function fetchPedidoById(pedidoId) {
  const json = await blingFetch(`/pedidos/vendas/${pedidoId}`);
  logger.info('Bling API: pedido consultado', { pedidoId });
  return json.data;
}

/**
 * Busca um contato pelo ID.
 * @param {number|string} contatoId
 * @returns {Promise<Object>} dados completos do contato
 */
export async function fetchContatoById(contatoId) {
  const json = await blingFetch(`/contatos/${contatoId}`);
  logger.info('Bling API: contato consultado', { contatoId });
  return json.data;
}

/**
 * Resolve um CPF/CNPJ para o contato correspondente no Bling.
 *
 * Não existe filtro `numeroDocumento` na listagem de contatos; usamos
 * `?pesquisa={doc}` (busca ampla) e filtramos pelo documento exato (só
 * dígitos) para evitar falso positivo.
 *
 * @param {string} cpf
 * @returns {Promise<Object|null>} contato com documento exato, ou null
 */
export async function resolveContatoByCpf(cpf) {
  const doc = onlyDigits(cpf);
  if (!doc) return null;

  const json = await blingFetch(`/contatos?pesquisa=${encodeURIComponent(doc)}`);
  const contatos = json.data ?? [];
  const match = contatos.find((c) => onlyDigits(c.numeroDocumento) === doc) ?? null;

  logger.info('Bling API: resolução por CPF', { encontrado: Boolean(match) });
  return match;
}

/**
 * Lista todos os pedidos de venda de um contato, paginando até o fim.
 *
 * @param {number|string} idContato
 * @param {{ limite?: number, maxPaginas?: number }} [opts]
 * @returns {Promise<Array<Object>>}
 */
export async function listPedidosByContatoId(idContato, opts = {}) {
  const limite = opts.limite ?? PAGE_SIZE;
  const maxPaginas = opts.maxPaginas ?? MAX_PAGES;
  const pedidos = [];

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const params = new URLSearchParams({
      idContato: String(idContato),
      pagina: String(pagina),
      limite: String(limite),
    });
    const json = await blingFetch(`/pedidos/vendas?${params}`);
    const data = json.data ?? [];
    pedidos.push(...data);

    // Última página: veio com menos itens que o limite.
    if (data.length < limite) break;

    if (pagina === maxPaginas) {
      logger.warn('Bling API: trava de páginas atingida ao listar pedidos', { idContato, maxPaginas });
    }
  }

  return pedidos;
}

/**
 * Histórico de pedidos de um cliente a partir do CPF/CNPJ.
 * Resolve o contato e lista seus pedidos (paginado). Retorna [] se o CPF
 * não corresponder a nenhum contato.
 *
 * @param {string} cpf
 * @returns {Promise<Array<Object>>}
 */
export async function listPedidosByCpf(cpf) {
  const contato = await resolveContatoByCpf(cpf);
  if (!contato) {
    logger.info('Bling API: nenhum contato para o CPF informado ao listar pedidos');
    return [];
  }
  return listPedidosByContatoId(contato.id);
}
