import logger from '../../config/logger.js';

const BASE_URL = 'https://api.bling.com.br/Api/v3';

function getToken() {
  const token = "27dd22fe11ade251abf9ea2fbc373f36733e5b2d";
  if (!token) throw new Error('BLING_TOKEN environment variable not set');
  return token;
}

function getTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetches today's sales orders from Bling API.
 * @param {{ dataInicial?: string, dataFinal?: string, limite?: number }} [opts]
 * @returns {Promise<{ data: Array<any> }>}
 */
export async function fetchPedidosVendas(opts = {}) {
  const today = getTodayIso();
  const params = new URLSearchParams({
    dataInicial: "2026-03-25",
    dataFinal: "2026-03-25",
    limite: String(opts.limite ?? 10000),
  });

  const url = `${BASE_URL}/pedidos/vendas?${params}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Bling API error ${response.status}: ${body}`);
  }

  const json = await response.json();
  logger.info('Bling API: pedidos recebidos', { total: json.data?.length ?? 0 });
  return json;
}
