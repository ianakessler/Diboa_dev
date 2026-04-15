# Guia: Corrigindo o Fluxo do Webhook Bling

## O Problema

O webhook do Bling é apenas uma **notificação enxuta**. Ele avisa que algo aconteceu, mas não traz os dados completos. Veja o que chega vs. o que o `webhookService.js` atual tenta acessar:

```
Chega no webhook              │  Código atual tenta acessar
─────────────────────────────-│──────────────────────────────
data.id ✅                    │  dados.id
data.situacao.valor ✅        │  dados.situacao.valor
data.contato.id ✅            │  dados.contato.id
data.total ✅                 │  dados.total
data.numero ✅                │  dados.numero
data.data ✅                  │  dados.data
                              │
❌ NÃO EXISTE                │  dados.contato.nome
❌ NÃO EXISTE                │  dados.contato.numeroDocumento
```

Além disso, o código desestrutura `{ dados }` do body, mas a propriedade real é `data`.

## A Solução

O fluxo correto é:

```
Webhook chega → Valida situação → Busca detalhes do pedido na API
→ Busca dados do contato na API → Processa e salva no banco
```

---

## Passo 1 — Exportar `blingFetch` e criar funções de consulta

O arquivo `src/services/routine/blingApi.js` já tem o wrapper `blingFetch`, mas ele não é exportado. Precisamos exportá-lo e adicionar duas funções novas.

### Alterações em `src/services/routine/blingApi.js`

```js
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
export async function blingFetch(path, options = {}) {  // ← adicionar export
  const token = await getValidAccessToken();

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
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
 * Busca um pedido de venda pelo ID.
 * Retorna o objeto completo do pedido (com contato.id, total, etc).
 *
 * @param {number} pedidoId - ID do pedido no Bling
 * @returns {Promise<Object>} - Dados completos do pedido
 */
export async function fetchPedidoById(pedidoId) {
  const json = await blingFetch(`/pedidos/vendas/${pedidoId}`);
  logger.info('Bling API: pedido consultado', { pedidoId });
  return json.data;
}

/**
 * Busca um contato pelo ID.
 * Retorna nome, numeroDocumento (CPF/CNPJ), etc.
 *
 * @param {number} contatoId - ID do contato no Bling
 * @returns {Promise<Object>} - Dados completos do contato
 */
export async function fetchContatoById(contatoId) {
  const json = await blingFetch(`/contatos/${contatoId}`);
  logger.info('Bling API: contato consultado', { contatoId });
  return json.data;
}

/**
 * Busca pedidos de venda do Bling (já existente).
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
```

> **O que mudou:**
> - `blingFetch` agora tem `export`
> - Nova função `fetchPedidoById(pedidoId)` — chama `GET /pedidos/vendas/{id}`
> - Nova função `fetchContatoById(contatoId)` — chama `GET /contatos/{id}`
> - Removidos os valores hardcoded de data em `fetchPedidosVendas`

---

## Passo 2 — Reescrever `webhookService.js`

O service precisa buscar os dados faltantes na API antes de salvar no banco.

### Novo `src/services/webhookService.js`

```js
import { cpf as cpfValidator } from 'cpf-cnpj-validator';
import pool from '../config/db.js';
import * as clienteRepo from '../repository/clienteRepository.js';
import * as vendaRepo from '../repository/vendaRepository.js';
import { fetchPedidoById, fetchContatoById } from './routine/blingApi.js';
import logger from '../config/logger.js';

export async function processarWebhookVenda(body) {
  // 1. Extrair dados do webhook (a propriedade é "data", não "dados")
  const { data } = body;

  if (!data?.id) {
    logger.warn('Webhook ignorado: payload sem data.id', { body });
    return;
  }

  // 2. Checar situação (valor 1 = confirmado)
  //    Se o webhook não trouxer situação, busca na API
  if (data.situacao && data.situacao.valor !== 1) {
    logger.info('Webhook ignorado: situação não confirmada', {
      pedidoId: data.id,
      situacao: data.situacao,
    });
    return;
  }

  // 3. Buscar dados completos do pedido na API do Bling
  const pedido = await fetchPedidoById(data.id);

  // 4. Validar situação do pedido completo (dupla checagem)
  if (pedido.situacao?.valor !== 1) {
    logger.info('Webhook ignorado após consulta: situação não confirmada', {
      pedidoId: pedido.id,
      situacao: pedido.situacao,
    });
    return;
  }

  // 5. Buscar dados do contato (nome, CPF)
  const contato = await fetchContatoById(pedido.contato.id);

  // 6. Validar CPF
  const doc = contato.numeroDocumento?.replace(/\D/g, '');
  if (!doc || !cpfValidator.isValid(doc)) {
    logger.info('Webhook ignorado: CPF inválido ou ausente', {
      pedidoId: pedido.id,
      contatoId: contato.id,
    });
    return;
  }

  // 7. Salvar no banco (transação)
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await clienteRepo.upsertIgnore(conn, {
      nome: contato.nome,
      cpf: doc,
      clienteId: contato.id,
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
      pedidoId: pedido.id,
      cpf: doc,
      total: pedido.total,
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
```

---

## Passo 3 — Ajustar `webhookController.js`

O controller já está correto na estrutura, mas vale garantir que erros da API do Bling sejam logados.

### `src/controllers/webhookController.js` (sem alteração necessária)

```js
import { processarWebhookVenda } from '../services/webhookService.js';
import logger from '../config/logger.js';

export async function handleBlingVendaWebhook(req, res) {
  // Responde 200 imediatamente para o Bling não reenviar
  res.status(200).json({ received: true });

  try {
    await processarWebhookVenda(req.body);
  } catch (error) {
    logger.error('Erro ao processar webhook Bling', {
      error: error.message,
      stack: error.stack,
    });
  }
}
```

> **Importante:** O `res.status(200)` vem ANTES do processamento.
> Isso é correto — o Bling espera resposta rápida. Se demorar, ele reenvia o webhook.

---

## Passo 4 — Ajuste no `app.js` (trust proxy)

Já discutido anteriormente, mas incluído aqui para completude:

```js
const app = express();
app.set('trust proxy', 1); // ← necessário por causa do ngrok
```

---

## Resumo das Alterações

| Arquivo | O que muda |
|---|---|
| `src/services/routine/blingApi.js` | Exporta `blingFetch`, adiciona `fetchPedidoById` e `fetchContatoById` |
| `src/services/webhookService.js` | Reescrito: extrai `data` (não `dados`), busca detalhes na API antes de salvar |
| `src/app.js` | Adiciona `app.set('trust proxy', 1)` |

---

## Fluxo Final (Diagrama)

```
Bling envia webhook (POST /api/v1/webhooks/bling/vendas)
  │
  ├─ blingSignature.js → valida HMAC
  │
  ├─ webhookController.js → responde 200 imediatamente
  │
  └─ webhookService.js (processamento assíncrono)
       │
       ├─ Extrai data.id e data.situacao do payload
       │
       ├─ situacao.valor !== 1? → ignora
       │
       ├─ GET /pedidos/vendas/{id} → dados completos do pedido
       │
       ├─ GET /contatos/{id} → nome e CPF do cliente
       │
       ├─ CPF inválido? → ignora
       │
       └─ Transação MySQL:
            ├─ Upsert cliente
            ├─ Insert venda
            ├─ Credita pontos
            └─ Marca venda como processada
```