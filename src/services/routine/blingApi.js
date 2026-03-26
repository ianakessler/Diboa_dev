import { getValidAccessToken } from './blingAuth.js';
import logger from '../../config/logger.js';
 
const BASE_URL = 'https://api.bling.com.br/Api/v3';
 
function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}
 
/**
 * Wrapper genérico para chamadas autenticadas ao Bling.
 * Obtém o token válido antes de cada requisição.
 */
async function blingFetch(path, options = {}) {
  const token = await getValidAccessToken();
 
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
 
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Bling API error ${response.status}: ${body}`);
  }
 
  return response.json();
}
 
/**
 * Busca pedidos de venda do Bling.
 *
 * @param {{ dataInicial?: string, dataFinal?: string, limite?: number }} [opts]
 * @returns {Promise<{ data: Array<any> }>}
 */
export async function fetchPedidosVendas(opts = {}) {
  const today = getTodayIso();
  const params = new URLSearchParams({
    dataInicial: opts.dataInicial ?? today,
    dataFinal:   opts.dataFinal   ?? today,
    limite:      String(opts.limite ?? 10000),
  });
 
  const json = await blingFetch(`/pedidos/vendas?${params}`);
  logger.info('Bling API: pedidos recebidos', { total: json.data?.length ?? 0 });
  return json;
}
 