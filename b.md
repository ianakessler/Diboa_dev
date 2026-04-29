# GUIA DE IMPLEMENTAÇÃO — INTEGRAÇÃO SHOPIFY × DIBOA FIDELIDADE

## INSTRUÇÕES PARA O AGENTE DE IA

Você é um engenheiro de software implementando a integração de um programa de fidelidade (API Diboa) com o Shopify. Este documento contém TUDO que você precisa: contexto do projeto, código existente completo, arquivos a criar, arquivos a modificar, e a ordem exata de execução.

**REGRAS:**
1. Leia TODO este documento antes de escrever qualquer código.
2. Siga a ordem das etapas (ETAPA 1 → 2 → 3...). Cada etapa depende da anterior.
3. Não altere arquivos que não estão listados na seção "ARQUIVOS A MODIFICAR".
4. Mantenha o padrão de código existente: ESM modules, async/await, classes de erro customizadas.
5. Todos os novos arquivos usam `import/export` (ESM), nunca `require`.
6. Ao concluir cada etapa, liste os arquivos criados/modificados como checklist.

---

## SEÇÃO 1: CONTEXTO DO PROJETO

### 1.1 O que é este projeto

O **Diboa Cashback** é uma API REST que gerencia um programa de fidelidade por pontos para a loja Shopify https://diboatabacaria.com.br. Clientes acumulam pontos a partir de compras (capturadas do ERP Bling) e podem resgatar esses pontos por cupons de desconto na loja Shopify.

### 1.2 Stack tecnológico

- **Runtime:** Node.js com ESM modules (`"type": "module"` no package.json)
- **Framework:** Express 5.2
- **Banco de dados:** MySQL (mysql2/promise com pool de conexões)
- **Segurança:** Helmet, express-rate-limit, HMAC para webhooks
- **Validação:** cpf-cnpj-validator
- **Padrão arquitetural:** Routes → Controllers → Services → Repositories → MySQL

### 1.3 Fluxo de negócio a implementar

```
Cliente abre widget → digita CPF → API retorna saldo e opções →
Cliente escolhe resgate → API debita pontos → API cria cupom no Shopify →
Cliente recebe código → usa no checkout → Webhook confirma uso
```

### 1.4 Estrutura atual de arquivos (ANTES das alterações)

```
src/
├── app.js                          ← Entrypoint Express
├── config/
│   ├── db.js                       ← Pool MySQL
│   ├── logger.js                   ← Logger com chalk
│   └── shopify.js                  ← [JÁ CRIADO] Config Shopify
├── controllers/
│   ├── authController.js           ← Auth Bling
│   ├── clienteController.js        ← CRUD clientes
│   ├── resgateController.js        ← Resgate de pontos (atual)
│   ├── shopifyAuthController.js    ← [JÁ CRIADO] OAuth Shopify
│   ├── syncController.js           ← Sync manual Bling
│   └── webhookController.js        ← Webhooks Bling
├── errors/
│   └── AppError.js                 ← Classes de erro customizadas
├── middleware/
│   ├── blingSignature.js           ← Verifica HMAC Bling
│   ├── errorHandler.js             ← Error handler global
│   └── shopifySignature.js         ← [JÁ CRIADO] Verifica HMAC webhooks Shopify
├── repository/
│   ├── clienteRepository.js        ← Queries MySQL clientes
│   └── vendaRepository.js          ← Queries MySQL vendas
├── routes/
│   ├── authRoutes.js               ← [JÁ MODIFICADO] Rotas auth Bling + Shopify
│   ├── clienteRoutes.js            ← Rotas clientes
│   ├── resgateRoutes.js            ← Rotas resgate
│   └── webhookRoutes.js            ← Rotas webhooks Bling
├── services/
│   ├── clienteService.js           ← Lógica de clientes
│   ├── resgateService.js           ← Lógica de resgate (atual)
│   ├── shopifyAuthService.js       ← [JÁ CRIADO] OAuth service Shopify
│   ├── webhookService.js           ← Processa webhooks Bling
│   └── routine/
│       ├── blingApi.js             ← Chamadas API Bling
│       ├── blingAuth.js            ← OAuth Bling
│       └── syncRoutine.js          ← Rotina diária de sync
└── validators/
    └── index.js                    ← validateCpf, validatePontos
```

---

## SEÇÃO 2: CÓDIGO EXISTENTE RELEVANTE (REFERÊNCIA)

Os arquivos abaixo já existem e NÃO devem ser recriados. São fornecidos como referência para entender os padrões usados.

### 2.1 src/errors/AppError.js (NÃO MODIFICAR)

```javascript
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(message = 'Saldo de pontos insuficiente') {
    super(message, 422, 'INSUFFICIENT_BALANCE');
  }
}
```

### 2.2 src/config/db.js (NÃO MODIFICAR)

```javascript
import mysql from 'mysql2/promise';
import logger from './logger.js';

const pool = mysql.createPool({
  host: process.env.DB_HOST ?? 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT ?? '10', 10),
  queueLimit: 0,
  timezone: 'Z',
});

export default pool;
```

### 2.3 src/validators/index.js (NÃO MODIFICAR)

```javascript
import { cpf as cpfValidator } from 'cpf-cnpj-validator';
import { BadRequestError } from '../errors/AppError.js';

export function validateCpf(raw) {
  if (typeof raw !== 'string') throw new BadRequestError('CPF inválido');
  const digits = raw.replace(/\D/g, '');
  if (!cpfValidator.isValid(digits)) throw new BadRequestError('CPF inválido');
  return digits;
}

export function validatePontos(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new BadRequestError('O campo pontos deve ser um inteiro positivo');
  }
  return num;
}
```

### 2.4 src/repository/clienteRepository.js — Funções relevantes (NÃO MODIFICAR)

```javascript
// As funções que você vai usar nos novos services:

export async function findByCpf(cpf) {
  const [rows] = await pool.query(
    'SELECT id, nome, numero_documento, client_id, pontos, email, telefone FROM clientes WHERE numero_documento = ? LIMIT 1',
    [cpf]
  );
  return rows[0] ?? null;
}

export async function findByCpfForUpdate(conn, cpf) {
  const [rows] = await conn.query(
    'SELECT id, client_id, pontos FROM clientes WHERE numero_documento = ? LIMIT 1 FOR UPDATE',
    [cpf]
  );
  return rows[0] ?? null;
}

export async function deductPontos(conn, id, pontos) {
  await conn.query('UPDATE clientes SET pontos = pontos - ? WHERE id = ?', [pontos, id]);
}

export async function insertResgate(conn, cliente_id, pontos) {
  await conn.query(
    'INSERT INTO historico_resgates (cliente_id, pontos_resgatados) VALUES(?, ?)',
    [cliente_id, pontos]
  );
}
```

### 2.5 src/services/resgateService.js — Resgate ATUAL (SERÁ SUBSTITUÍDO)

```javascript
import pool from '../config/db.js';
import * as clienteRepo from '../repository/clienteRepository.js';
import { validateCpf, validatePontos } from '../validators/index.js';
import { NotFoundError, InsufficientBalanceError } from '../errors/AppError.js';
import logger from '../config/logger.js';

export async function resgatar(rawCpf, rawPontos) {
  const cpf = validateCpf(rawCpf);
  const pontos = validatePontos(rawPontos);

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
    await conn.commit();
    logger.info('Resgate efetuado', { clienteId: cliente.id, pontos });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
```

### 2.6 src/services/shopifyAuthService.js — Funções disponíveis (JÁ CRIADO)

```javascript
// Já existe e exporta:
export async function loadToken(shop)
// → Retorna { accessToken, scope } ou null
// Use para obter o token ao criar cupons.
```

### 2.7 src/config/shopify.js — Já criado, exporta:

```javascript
export function isValidShopDomain(shop)  // valida loja.myshopify.com
export function graphqlUrl(shop)          // https://{shop}/admin/api/{version}/graphql.json
export { SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_SCOPES, SHOPIFY_REDIRECT_URI, SHOPIFY_API_VERSION }
```

### 2.8 src/app.js ATUAL (SERÁ MODIFICADO)

```javascript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import clienteRoutes from './routes/clienteRoutes.js';
import resgateRoutes from './routes/resgateRoutes.js';
import authRoutes from './routes/authRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import logger from './config/logger.js';
import pool from './config/db.js';
import { executarRotina } from './services/routine/syncRoutine.js';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT ?? 9292;

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({
  verify: (req, _res, buf) => {
    if (req.originalUrl?.startsWith('/api/v1/webhooks')) {
      req.rawBody = buf;
    }
  },
}));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, try again later' },
  skip: (req) => req.originalUrl?.startsWith('/api/v1/webhooks'),
}));

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use('/api/v1', clienteRoutes);
app.use('/api/v1', resgateRoutes);
app.use('/api/v1', authRoutes);
app.use('/api/v1', webhookRoutes);
app.use('/webhooks', webhookRoutes);

// ── check bling signature ────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.includes('webhooks') && !req.path.startsWith('/api/v1')) {
    logger.warn('Webhook em path incorreto', {
      path: req.originalUrl,
      ip: req.ip,
      headers: {
        'x-bling-signature-256': req.headers['x-bling-signature-256'] ?? 'AUSENTE',
        'user-agent': req.headers['user-agent'],
      },
    });
  }
  next();
});

// ── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
});

// ── Global Error Handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, { env: process.env.NODE_ENV ?? 'development' });
});

// ── Cron: rotina diária de sincronização (23:55) ─────────────────────────────
cron.schedule('55 23 * * *', async () => {
  logger.info('Cron: iniciando rotina diaria de sincronizacao');
  try {
    const result = await executarRotina();
    logger.info('Cron: rotina concluida', result);
  } catch (err) {
    logger.error('Cron: erro na rotina', { error: err.message });
  }
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await pool.end();
    logger.info('MySQL pool closed. Process exiting.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
```

---

## SEÇÃO 3: VARIÁVEIS DE AMBIENTE

O arquivo `.env` precisa conter estas variáveis (além das existentes do Bling/MySQL):

```env
# Shopify OAuth
SHOPIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_SCOPES=write_discounts,read_discounts,read_orders
SHOPIFY_REDIRECT_URI=https://seu-dominio.com/api/v1/auth/shopify/callback
SHOPIFY_API_VERSION=2026-04

# Shopify Store (usado pelo serviço de cupons)
SHOPIFY_STORE_DOMAIN=diboatabacaria.myshopify.com

# Segurança
ADMIN_API_KEY=uma-chave-secreta-para-rotas-admin
CORS_ORIGIN=https://diboatabacaria.com.br
```

---

## SEÇÃO 4: MIGRAÇÕES SQL

Execute estes SQLs no banco MySQL ANTES de iniciar qualquer alteração de código.

### Migration 001 — Tabela de tokens Shopify (JÁ CRIADA)

```sql
CREATE TABLE IF NOT EXISTS shopify_tokens (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  shop         VARCHAR(255) UNIQUE NOT NULL,
  access_token VARCHAR(500) NOT NULL,
  scope        TEXT,
  installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Migration 002 — Tabela de cupons de resgate (CRIAR AGORA)

```sql
CREATE TABLE IF NOT EXISTS cupons_resgate (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id         INT NOT NULL,
  cpf                VARCHAR(11) NOT NULL,
  pontos_resgatados  INT NOT NULL,
  valor_desconto     DECIMAL(10,2) NOT NULL,
  codigo_cupom       VARCHAR(50) UNIQUE NOT NULL,
  shopify_discount_id VARCHAR(255) DEFAULT NULL,
  status             ENUM('criado','utilizado','expirado','erro') DEFAULT 'criado',
  criado_em          DATETIME DEFAULT CURRENT_TIMESTAMP,
  utilizado_em       DATETIME DEFAULT NULL,
  expira_em          DATETIME NOT NULL,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  INDEX idx_codigo (codigo_cupom),
  INDEX idx_status (status),
  INDEX idx_cliente (cliente_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## SEÇÃO 5: ETAPAS DE IMPLEMENTAÇÃO

---

### ETAPA 1: Criar `src/services/shopifyDiscountService.js`

**Objetivo:** Módulo que encapsula a criação e deleção de cupons de desconto no Shopify via GraphQL Admin API.

**Dependências internas:** `src/config/shopify.js`, `src/services/shopifyAuthService.js`, `src/config/logger.js`, `src/errors/AppError.js`

**Dependência Node.js:** `node:crypto` (nativo, para gerar códigos aleatórios)

**Lógica:**

1. Importar `graphqlUrl` de `config/shopify.js` e `loadToken` de `shopifyAuthService.js`
2. Função auxiliar `gerarCodigoCupom()`: gera string no formato `DIBOA-XXXXXXXX` onde X são 8 caracteres hexadecimais aleatórios maiúsculos usando `crypto.randomBytes(4).toString('hex').toUpperCase()`
3. Função auxiliar `shopifyGraphQL(shop, query, variables)`: faz POST para `graphqlUrl(shop)` com header `X-Shopify-Access-Token` obtido via `loadToken(shop)`. Se token não existe, lançar `AppError('Token Shopify não encontrado. Instale o app primeiro.', 500, 'SHOPIFY_NOT_INSTALLED')`. Se resposta não for ok, lançar `AppError`. Retornar `data` do JSON.
4. Exportar `async function criarCupomDesconto({ shop, titulo, valorDesconto, diasExpiracao = 30 })`:
   - Gerar código com `gerarCodigoCupom()`
   - Calcular `startsAt` = agora (ISO string) e `endsAt` = agora + diasExpiracao dias (ISO string)
   - Executar mutation GraphQL `discountCodeBasicCreate` com:
     ```graphql
     mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
       discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
         codeDiscountNode {
           id
           codeDiscount {
             ... on DiscountCodeBasic {
               title
               codes(first: 1) {
                 nodes { code }
               }
               startsAt
               endsAt
             }
           }
         }
         userErrors {
           field
           message
         }
       }
     }
     ```
   - Variables:
     ```json
     {
       "basicCodeDiscount": {
         "title": "<titulo>",
         "code": "<codigo gerado>",
         "startsAt": "<ISO date>",
         "endsAt": "<ISO date>",
         "usageLimit": 1,
         "appliesOncePerCustomer": true,
         "customerGets": {
           "value": {
             "discountAmount": {
               "amount": "<valorDesconto como string>",
               "appliesOnEachItem": false
             }
           },
           "items": { "all": true }
         }
       }
     }
     ```
   - Verificar `userErrors` na resposta. Se houver, lançar `AppError` com a primeira mensagem.
   - Retornar `{ codigoCupom, shopifyDiscountId, startsAt, endsAt }` onde `shopifyDiscountId` é o `codeDiscountNode.id`

5. Exportar `async function deletarCupomShopify(shop, shopifyDiscountId)`:
   - Mutation: `mutation { discountCodeDelete(id: "${shopifyDiscountId}") { deletedCodeDiscountId userErrors { field message } } }`
   - Não lançar erro se falhar (é limpeza, não crítico) — apenas logar

**Arquivo completo a criar:** `src/services/shopifyDiscountService.js`

---

### ETAPA 2: Criar `src/repository/cupomRepository.js`

**Objetivo:** Funções de acesso à tabela `cupons_resgate`.

**Dependência interna:** `src/config/db.js`

**Padrão:** Mesmo padrão de `clienteRepository.js` — aceitar `conn` (connection) como primeiro parâmetro para operações dentro de transações, usar `pool` diretamente para leituras avulsas.

**Funções a exportar:**

1. `async function insertCupom(conn, { clienteId, cpf, pontosResgatados, valorDesconto, codigoCupom, shopifyDiscountId, expiraEm })` — INSERT na tabela, retornar `result.insertId`

2. `async function findByCodigo(codigo)` — SELECT por `codigo_cupom` onde status = 'criado'. Usar `pool` diretamente (leitura avulsa).

3. `async function marcarComoUtilizado(conn, codigo)` — UPDATE: `status = 'utilizado'`, `utilizado_em = NOW()` WHERE `codigo_cupom = ?` AND `status = 'criado'`

4. `async function findExpirados()` — SELECT WHERE `status = 'criado'` AND `expira_em < NOW()`. Usar `pool` diretamente.

5. `async function marcarComoExpirado(conn, id)` — UPDATE `status = 'expirado'` WHERE `id = ?`

6. `async function findAtivosByClienteId(clienteId)` — SELECT WHERE `cliente_id = ?` AND `status = 'criado'` ORDER BY `criado_em DESC`. Usar `pool` diretamente.

**Arquivo completo a criar:** `src/repository/cupomRepository.js`

---

### ETAPA 3: Criar `src/services/fidelidadeService.js`

**Objetivo:** Lógica de negócio do programa de fidelidade — consultar saldo e resgatar pontos gerando cupom.

**Dependências internas:**
- `src/config/db.js` (pool)
- `src/repository/clienteRepository.js` (findByCpf, findByCpfForUpdate, deductPontos, insertResgate)
- `src/repository/cupomRepository.js` (insertCupom, findAtivosByClienteId)
- `src/services/shopifyDiscountService.js` (criarCupomDesconto)
- `src/validators/index.js` (validateCpf, validatePontos)
- `src/errors/AppError.js` (NotFoundError, InsufficientBalanceError, BadRequestError)
- `src/config/logger.js`

**Constante de configuração (definir no topo do arquivo):**

```javascript
export const CONFIG_FIDELIDADE = {
  PONTOS_POR_REAL: 20,
  OPCOES_RESGATE: [
    { pontos: 200, valor: 10 },
    { pontos: 500, valor: 25 },
    { pontos: 1000, valor: 50 },
    { pontos: 2000, valor: 100 },
  ],
  DIAS_EXPIRACAO: 30,
  SHOP: process.env.SHOPIFY_STORE_DOMAIN || 'diboatabacaria.myshopify.com',
};
```

**Função 1: `async function consultarSaldo(rawCpf)`**

1. `const cpf = validateCpf(rawCpf)`
2. `const cliente = await clienteRepo.findByCpf(cpf)` — se null, lançar NotFoundError
3. Calcular opções disponíveis: filtrar `CONFIG_FIDELIDADE.OPCOES_RESGATE` onde `opcao.pontos <= cliente.pontos`
4. Buscar cupons ativos: `await cupomRepo.findAtivosByClienteId(cliente.id)`
5. Retornar:
```javascript
{
  cliente: { nome: cliente.nome, pontos: cliente.pontos, cpf: cliente.numero_documento },
  opcoesDisponiveis: [...],  // array filtrado
  cuponsAtivos: [...]         // cupons com status 'criado'
}
```

**Função 2: `async function resgatarPontos(rawCpf, rawPontos)`**

1. Validar inputs: `const cpf = validateCpf(rawCpf)`, `const pontos = validatePontos(rawPontos)`
2. Verificar que `pontos` corresponde a uma opção válida: procurar em `CONFIG_FIDELIDADE.OPCOES_RESGATE` a opção onde `opcao.pontos === pontos`. Se não encontrar, lançar `BadRequestError('Opção de resgate inválida')`. Obter `valorDesconto = opcao.valor`.
3. Obter conexão do pool: `const conn = await pool.getConnection()`
4. Dentro de try/catch/finally:
   a. `await conn.beginTransaction()`
   b. `const cliente = await clienteRepo.findByCpfForUpdate(conn, cpf)` — se null, throw NotFoundError
   c. Se `cliente.pontos < pontos`, throw InsufficientBalanceError
   d. `await clienteRepo.deductPontos(conn, cliente.id, pontos)`
   e. `await clienteRepo.insertResgate(conn, cliente.client_id, pontos)`
   f. Criar cupom no Shopify:
      ```javascript
      const cupomShopify = await criarCupomDesconto({
        shop: CONFIG_FIDELIDADE.SHOP,
        titulo: `Resgate Fidelidade - ${pontos}pts - R$${valorDesconto}`,
        valorDesconto,
        diasExpiracao: CONFIG_FIDELIDADE.DIAS_EXPIRACAO,
      });
      ```
   g. Registrar cupom no banco:
      ```javascript
      await cupomRepo.insertCupom(conn, {
        clienteId: cliente.id,
        cpf,
        pontosResgatados: pontos,
        valorDesconto,
        codigoCupom: cupomShopify.codigoCupom,
        shopifyDiscountId: cupomShopify.shopifyDiscountId,
        expiraEm: cupomShopify.endsAt,
      });
      ```
   h. `await conn.commit()`
   i. Logar sucesso
   j. Retornar: `{ codigoCupom: cupomShopify.codigoCupom, valorDesconto, expiraEm: cupomShopify.endsAt }`
5. No catch: `await conn.rollback()` e rethrow
6. No finally: `conn.release()`

**IMPORTANTE sobre rollback:** Se a chamada ao Shopify (passo f) falhar, o rollback do MySQL desfaz a dedução de pontos automaticamente. Se a chamada ao Shopify funcionar mas o INSERT do cupom (passo g) falhar, haverá um cupom órfão no Shopify — logar erro com os dados para limpeza manual.

**Arquivo completo a criar:** `src/services/fidelidadeService.js`

---

### ETAPA 4: Criar `src/controllers/fidelidadeController.js`

**Objetivo:** Controllers HTTP para as rotas de fidelidade.

**Funções:**

1. `async function consultarSaldo(req, res, next)`:
   - Chamar `fidelidadeService.consultarSaldo(req.params.cpf)`
   - Retornar `res.status(200).json(resultado)`
   - Em caso de erro, `next(error)`

2. `async function resgatarPontos(req, res, next)`:
   - Extrair `{ cpf, pontos }` do `req.body`
   - Chamar `fidelidadeService.resgatarPontos(cpf, pontos)`
   - Retornar `res.status(201).json(resultado)`
   - Em caso de erro, `next(error)`

**Arquivo completo a criar:** `src/controllers/fidelidadeController.js`

---

### ETAPA 5: Criar `src/routes/fidelidadeRoutes.js`

**Rotas:**

```javascript
import { Router } from 'express';
import { consultarSaldo, resgatarPontos } from '../controllers/fidelidadeController.js';

const router = Router();

router.get('/fidelidade/:cpf', consultarSaldo);
router.post('/fidelidade/resgate', resgatarPontos);

export default router;
```

**Arquivo completo a criar:** `src/routes/fidelidadeRoutes.js`

---

### ETAPA 6: Criar `src/middleware/apiKeyAuth.js`

**Objetivo:** Proteger rotas administrativas com API Key no header.

**Lógica:**

```javascript
import { AppError } from '../errors/AppError.js';

export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'API key inválida ou ausente' },
    });
  }
  next();
}
```

**Arquivo completo a criar:** `src/middleware/apiKeyAuth.js`

---

### ETAPA 7: Criar `src/controllers/shopifyWebhookController.js`

**Objetivo:** Processar webhook `orders/create` do Shopify para marcar cupons como utilizados.

**Lógica:**

1. Exportar `async function handleShopifyOrderWebhook(req, res)`:
   a. Responder imediatamente: `res.status(200).json({ received: true })` (sem await)
   b. Dentro de try/catch:
      - Extrair `discount_codes` do body: `const discountCodes = req.body.discount_codes || []`
      - Para cada item em `discountCodes`:
        - Buscar o código na tabela cupons_resgate: `await cupomRepo.findByCodigo(item.code)`
        - Se encontrar (e status = 'criado'):
          - Obter conexão, iniciar transação
          - `await cupomRepo.marcarComoUtilizado(conn, item.code)`
          - Commit, release
          - Logar: `'Cupom utilizado via webhook Shopify'`
   c. No catch: apenas logar erro (não re-throw, pois já respondemos 200)

**Arquivo completo a criar:** `src/controllers/shopifyWebhookController.js`

---

### ETAPA 8: MODIFICAR `src/routes/webhookRoutes.js`

**Arquivo atual:**

```javascript
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyBlingSignature } from '../middleware/blingSignature.js';
import { handleBlingVendaWebhook } from '../controllers/webhookController.js';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many webhook requests' },
});

router.post('/webhooks/bling/vendas', webhookLimiter, verifyBlingSignature, handleBlingVendaWebhook);

export default router;
```

**Alteração:** Adicionar a rota de webhook do Shopify com seu middleware de verificação.

**Código novo COMPLETO do arquivo:**

```javascript
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyBlingSignature } from '../middleware/blingSignature.js';
import { verifyShopifyWebhook } from '../middleware/shopifySignature.js';
import { handleBlingVendaWebhook } from '../controllers/webhookController.js';
import { handleShopifyOrderWebhook } from '../controllers/shopifyWebhookController.js';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many webhook requests' },
});

// ── Bling Webhooks ───────────────────────────────────────────────────────────
router.post('/webhooks/bling/vendas', webhookLimiter, verifyBlingSignature, handleBlingVendaWebhook);

// ── Shopify Webhooks ─────────────────────────────────────────────────────────
router.post('/webhooks/shopify/orders', webhookLimiter, verifyShopifyWebhook, handleShopifyOrderWebhook);

export default router;
```

---

### ETAPA 9: MODIFICAR `src/routes/clienteRoutes.js`

**Objetivo:** Proteger rotas administrativas com API Key.

**Arquivo atual:**

```javascript
import { Router } from 'express';
import { deleteClient, editClient, getAllClients, getAllVendas, getClientByCpf, getHistoricoResgates } from '../controllers/clienteController.js';
import { syncClients } from '../controllers/syncController.js';

const router = Router();

router.get('/clients', getAllClients);
router.get('/clients/cpf/:cpf', getClientByCpf);
router.get('/historico/resgates/:cpf', getHistoricoResgates);
router.get('/historico/compras/:cpf', getAllVendas);
router.post('/sync', syncClients);
router.patch('/clients/:cpf', editClient);
router.delete('/clients/:cpf', deleteClient);

export default router;
```

**Código novo COMPLETO do arquivo:**

```javascript
import { Router } from 'express';
import { deleteClient, editClient, getAllClients, getAllVendas, getClientByCpf, getHistoricoResgates } from '../controllers/clienteController.js';
import { syncClients } from '../controllers/syncController.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';

const router = Router();

// ── Rotas públicas (usadas pelo frontend/widget) ────────────────────────────
router.get('/clients/cpf/:cpf', getClientByCpf);
router.get('/historico/resgates/:cpf', getHistoricoResgates);
router.get('/historico/compras/:cpf', getAllVendas);

// ── Rotas administrativas (protegidas por API Key) ──────────────────────────
router.get('/clients', requireApiKey, getAllClients);
router.post('/sync', requireApiKey, syncClients);
router.patch('/clients/:cpf', requireApiKey, editClient);
router.delete('/clients/:cpf', requireApiKey, deleteClient);

export default router;
```

---

### ETAPA 10: MODIFICAR `src/app.js`

**Alterações necessárias:**

1. Importar `fidelidadeRoutes`
2. Registrar `fidelidadeRoutes` no router
3. Adicionar cron job para expirar cupons (diário às 01:00)

**Código novo COMPLETO do arquivo:**

```javascript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import clienteRoutes from './routes/clienteRoutes.js';
import resgateRoutes from './routes/resgateRoutes.js';
import fidelidadeRoutes from './routes/fidelidadeRoutes.js';
import authRoutes from './routes/authRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import logger from './config/logger.js';
import pool from './config/db.js';
import { executarRotina } from './services/routine/syncRoutine.js';

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT ?? 9292;

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({
  verify: (req, _res, buf) => {
    if (req.originalUrl?.startsWith('/api/v1/webhooks')) {
      req.rawBody = buf;
    }
  },
}));

// CORS restrito ao domínio da loja (ajustar conforme necessidade)
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Permitir requests sem origin (Postman, server-to-server, webhooks)
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Bloqueado pelo CORS'));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true,
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, try again later' },
  skip: (req) => req.originalUrl?.startsWith('/api/v1/webhooks'),
}));

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.use('/api/v1', clienteRoutes);
app.use('/api/v1', resgateRoutes);
app.use('/api/v1', fidelidadeRoutes);
app.use('/api/v1', authRoutes);
app.use('/api/v1', webhookRoutes);
// rota para retry do bling
app.use('/webhooks', webhookRoutes);

// ── check bling signature ────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.includes('webhooks') && !req.path.startsWith('/api/v1')) {
    logger.warn('Webhook em path incorreto', {
      path: req.originalUrl,
      ip: req.ip,
      headers: {
        'x-bling-signature-256': req.headers['x-bling-signature-256'] ?? 'AUSENTE',
        'user-agent': req.headers['user-agent'],
      },
    });
  }
  next();
});

// ── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } });
});

// ── Global Error Handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, { env: process.env.NODE_ENV ?? 'development' });
});

// ── Cron: rotina diária de sincronização Bling (23:55) ───────────────────────
cron.schedule('55 23 * * *', async () => {
  logger.info('Cron: iniciando rotina diaria de sincronizacao');
  try {
    const result = await executarRotina();
    logger.info('Cron: rotina concluida', result);
  } catch (err) {
    logger.error('Cron: erro na rotina', { error: err.message });
  }
});

// ── Cron: expirar cupons vencidos (01:00) ────────────────────────────────────
cron.schedule('0 1 * * *', async () => {
  logger.info('Cron: verificando cupons expirados');
  try {
    // Import dinâmico para evitar circular dependency
    const cupomRepo = await import('./repository/cupomRepository.js');
    const expirados = await cupomRepo.findExpirados();

    if (expirados.length === 0) {
      logger.info('Cron: nenhum cupom expirado');
      return;
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const cupom of expirados) {
        await cupomRepo.marcarComoExpirado(conn, cupom.id);
      }
      await conn.commit();
      logger.info('Cron: cupons expirados marcados', { total: expirados.length });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    logger.error('Cron: erro ao expirar cupons', { error: err.message });
  }
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await pool.end();
    logger.info('MySQL pool closed. Process exiting.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
```

---

## SEÇÃO 6: MAPA FINAL DE ROTAS (APÓS TODAS AS ALTERAÇÕES)

```
GET    /health                                  → Health check
GET    /api/v1/clients                          → [API_KEY] Lista todos os clientes
GET    /api/v1/clients/cpf/:cpf                 → Busca cliente por CPF
PATCH  /api/v1/clients/:cpf                     → [API_KEY] Edita cliente
DELETE /api/v1/clients/:cpf                     → [API_KEY] Deleta cliente
GET    /api/v1/historico/resgates/:cpf           → Histórico de resgates
GET    /api/v1/historico/compras/:cpf            → Histórico de compras
POST   /api/v1/sync                             → [API_KEY] Sincronização manual Bling
POST   /api/v1/resgates                         → Resgate legado (debita pontos, SEM cupom)
GET    /api/v1/fidelidade/:cpf                  → Consulta saldo + opções de resgate
POST   /api/v1/fidelidade/resgate               → Resgate COM cupom Shopify
GET    /api/v1/auth/bling                       → Inicia OAuth Bling
GET    /api/v1/auth/bling/callback              → Callback OAuth Bling
GET    /api/v1/auth/shopify                     → Inicia OAuth Shopify
GET    /api/v1/auth/shopify/callback            → Callback OAuth Shopify
GET    /api/v1/auth/shopify/status              → Verifica se app está instalado
POST   /api/v1/webhooks/bling/vendas            → Webhook Bling (vendas)
POST   /api/v1/webhooks/shopify/orders          → Webhook Shopify (pedidos)
```

---

## SEÇÃO 7: CHECKLIST DE VERIFICAÇÃO

Após implementar todas as etapas, verificar:

- [ ] Migration 002 executada no banco (tabela `cupons_resgate` existe)
- [ ] `src/services/shopifyDiscountService.js` criado e exporta `criarCupomDesconto` e `deletarCupomShopify`
- [ ] `src/repository/cupomRepository.js` criado e exporta todas as 6 funções
- [ ] `src/services/fidelidadeService.js` criado e exporta `consultarSaldo` e `resgatarPontos`
- [ ] `src/controllers/fidelidadeController.js` criado e exporta 2 funções
- [ ] `src/routes/fidelidadeRoutes.js` criado com GET e POST
- [ ] `src/middleware/apiKeyAuth.js` criado e exporta `requireApiKey`
- [ ] `src/controllers/shopifyWebhookController.js` criado
- [ ] `src/routes/webhookRoutes.js` MODIFICADO — adicionada rota `/webhooks/shopify/orders`
- [ ] `src/routes/clienteRoutes.js` MODIFICADO — rotas admin protegidas com `requireApiKey`
- [ ] `src/app.js` MODIFICADO — importa fidelidadeRoutes, CORS restrito, cron de expiração
- [ ] Variáveis de ambiente `SHOPIFY_STORE_DOMAIN` e `ADMIN_API_KEY` adicionadas ao .env
- [ ] Nenhum arquivo existente foi deletado ou renomeado
- [ ] Todos os imports usam ESM (import/export), nunca require
- [ ] Todos os erros usam classes de `src/errors/AppError.js`
- [ ] Transações MySQL seguem padrão: getConnection → beginTransaction → operações → commit → release (com rollback no catch e release no finally)

---

## SEÇÃO 8: RESUMO DAS CRIAÇÕES E MODIFICAÇÕES

### Arquivos NOVOS a criar (6 arquivos):
1. `src/services/shopifyDiscountService.js`
2. `src/repository/cupomRepository.js`
3. `src/services/fidelidadeService.js`
4. `src/controllers/fidelidadeController.js`
5. `src/routes/fidelidadeRoutes.js`
6. `src/middleware/apiKeyAuth.js`
7. `src/controllers/shopifyWebhookController.js`

### Arquivos EXISTENTES a modificar (3 arquivos):
1. `src/routes/webhookRoutes.js` — adicionar rota Shopify
2. `src/routes/clienteRoutes.js` — adicionar requireApiKey
3. `src/app.js` — importar fidelidadeRoutes, melhorar CORS, adicionar cron

### Arquivos que NÃO devem ser tocados:
- `src/config/db.js`
- `src/config/logger.js`
- `src/config/shopify.js` (já criado)
- `src/errors/AppError.js`
- `src/middleware/blingSignature.js`
- `src/middleware/errorHandler.js`
- `src/middleware/shopifySignature.js` (já criado)
- `src/repository/clienteRepository.js`
- `src/repository/vendaRepository.js`
- `src/services/clienteService.js`
- `src/services/resgateService.js` (mantido como legado)
- `src/services/shopifyAuthService.js` (já criado)
- `src/services/webhookService.js`
- `src/services/routine/*`
- `src/validators/index.js`
- `src/controllers/authController.js`
- `src/controllers/clienteController.js`
- `src/controllers/resgateController.js`
- `src/controllers/shopifyAuthController.js` (já criado)
- `src/controllers/syncController.js`
- `src/controllers/webhookController.js`
- `src/routes/authRoutes.js` (já modificado)
- `src/routes/resgateRoutes.js`