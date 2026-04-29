# Relatório Técnico: Integração Diboa Fidelidade × Shopify

**Projeto:** Programa de Fidelidade — Diboa Tabacaria  
**Loja:** https://diboatabacaria.com.br  
**Data:** 28 de Abril de 2026  
**Stack Atual:** Node.js (Express 5) + MySQL + Bling ERP  

---

## 1. DIAGNÓSTICO DO CÓDIGO ATUAL

### 1.1 Arquitetura Existente

O sistema Diboa é uma API REST em Node.js (ESM) que funciona como um programa de cashback por pontos. Ela se integra ao ERP Bling para capturar vendas e converter valores em pontos para clientes identificados por CPF. A estrutura segue um padrão em camadas bem definido:

**Camadas identificadas:** `routes → controllers → services → repository → MySQL`

O projeto já conta com boas práticas como Helmet, rate limiting, CORS configurável, graceful shutdown, validação de CPF, tratamento de erros centralizado com classes customizadas (AppError, NotFoundError, InsufficientBalanceError), transações MySQL com row-level locking (FOR UPDATE), e verificação de assinatura HMAC para webhooks do Bling.

### 1.2 Pontos Fortes

O código possui transações atômicas com `FOR UPDATE` no resgate de pontos, o que é excelente para evitar race conditions. O sistema de upsert idempotente para clientes e vendas evita duplicações. A separação de responsabilidades entre camadas está clara, e o cron de sincronização diário (23:55) funciona como fallback caso webhooks do Bling falhem.

### 1.3 Vulnerabilidades e Gaps Identificados

**Segurança crítica:** Nenhuma rota possui autenticação. Os endpoints `GET /api/v1/clients`, `PATCH /api/v1/clients/:cpf`, e `DELETE /api/v1/clients/:cpf` estão abertos ao público. Qualquer pessoa com acesso à URL pode listar todos os clientes, editar pontos ou deletar registros.

**CORS aberto:** A variável `CORS_ORIGIN` aceita `*` como fallback, o que em produção significa que qualquer domínio pode fazer requisições à API.

**Resgate sem cupom Shopify:** O endpoint `POST /api/v1/resgates` apenas debita pontos no banco de dados mas não gera nenhum artefato utilizável pelo cliente (como um cupom de desconto). A ponte com o Shopify simplesmente não existe ainda.

**Webhook responde antes de processar:** Em `webhookController.js`, o `res.status(200).json()` é enviado com `await` antes do processamento. Embora essa seja uma prática comum para webhooks (responder rápido e processar depois), usar `await` no `res.json` é desnecessário e pode causar confusão.

**Logger sem persistência:** O logger usa apenas `console.*` com chalk. Em produção, logs se perdem com reinicializações. Não há integração com serviços de log ou rotação de arquivos.

**Ausência de testes automatizados:** Os arquivos em `/tests` são arquivos `.http` para testes manuais. Não há testes unitários ou de integração.

---

## 2. PLANO DE EXECUÇÃO (ROADMAP)

### FASE 1 — Preparação da Infraestrutura Shopify (Estimativa: 2-3 dias)

**Passo 1.1: Configurar o Custom App no Shopify**

No painel de administrador do Shopify (Settings → Apps and sales channels → Develop apps), garantir que o app já criado possua os seguintes Access Scopes:

- `write_discounts` — criar e gerenciar cupons de desconto
- `read_orders` — ler pedidos para confirmar uso de cupom
- `write_price_rules` — (se usar REST API legada) criar regras de preço

Gerar o Admin API Access Token e armazená-lo como variável de ambiente `SHOPIFY_ACCESS_TOKEN`.

**Passo 1.2: Definir as variáveis de ambiente**

Adicionar ao `.env`:

```
SHOPIFY_STORE_DOMAIN=diboatabacaria.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2026-04
SHOPIFY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxx
```

**Passo 1.3: Criar tabela de cupons no MySQL**

```sql
CREATE TABLE cupons_resgate (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  cpf VARCHAR(11) NOT NULL,
  pontos_resgatados INT NOT NULL,
  valor_desconto DECIMAL(10,2) NOT NULL,
  codigo_cupom VARCHAR(50) UNIQUE NOT NULL,
  shopify_discount_id VARCHAR(100),
  status ENUM('criado', 'utilizado', 'expirado', 'erro') DEFAULT 'criado',
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  utilizado_em DATETIME NULL,
  expira_em DATETIME NOT NULL,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);
```

### FASE 2 — Serviço de Integração com Shopify (Estimativa: 3-4 dias)

**Passo 2.1: Criar o módulo `src/services/shopifyService.js`**

Este módulo encapsula toda comunicação com a Shopify Admin GraphQL API. A mutation principal é a `discountCodeBasicCreate`, que cria um código de desconto de valor fixo (amount off), de uso único.

**Endpoint Shopify a utilizar:**
```
POST https://{store}.myshopify.com/admin/api/2026-04/graphql.json
Header: X-Shopify-Access-Token: {token}
```

**Mutation GraphQL:**
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

**Variáveis para cupom de uso único:**
```json
{
  "basicCodeDiscount": {
    "title": "Resgate Fidelidade - CPF ***XXX - 500pts",
    "code": "DIBOA-XXXXXX",
    "startsAt": "2026-04-28T00:00:00Z",
    "endsAt": "2026-05-28T23:59:59Z",
    "usageLimit": 1,
    "appliesOncePerCustomer": true,
    "customerGets": {
      "value": {
        "discountAmount": {
          "amount": "25.00",
          "appliesOnEachItem": false
        }
      },
      "items": { "all": true }
    }
  }
}
```

Pontos-chave: `usageLimit: 1` garante uso único. O código deve ser gerado aleatoriamente (ex: `DIBOA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`). O `endsAt` define expiração automática (recomendo 30 dias).

**Passo 2.2: Criar o módulo de conversão de pontos**

Definir a taxa de conversão pontos → reais (ex: 20 pontos = R$1,00). Criar opções de resgate pré-definidas:

| Opção | Pontos | Valor do Cupom |
|-------|--------|----------------|
| A     | 200    | R$ 10,00       |
| B     | 500    | R$ 25,00       |
| C     | 1000   | R$ 50,00       |
| D     | 2000   | R$ 100,00      |

### FASE 3 — Refatoração do Fluxo de Resgate (Estimativa: 2-3 dias)

**Passo 3.1: Criar novo endpoint de consulta de saldo + opções**

`GET /api/v1/fidelidade/:cpf`

Este endpoint retorna o saldo de pontos do cliente e as opções de resgate disponíveis (filtrando apenas aquelas cujos pontos o cliente possui). Será chamado pelo front-end ao consultar o CPF.

**Passo 3.2: Refatorar o endpoint de resgate**

`POST /api/v1/fidelidade/resgate`

O novo fluxo transacional:

1. Validar CPF e pontos
2. Verificar saldo com `FOR UPDATE`
3. Debitar pontos no banco
4. Registrar na tabela `cupons_resgate`
5. Chamar Shopify GraphQL para criar o cupom
6. Atualizar `cupons_resgate` com o `shopify_discount_id`
7. Retornar o código do cupom ao front-end
8. Em caso de falha na Shopify, fazer rollback dos pontos

**Passo 3.3: Implementar autenticação nos endpoints**

Criar middleware de API Key para rotas administrativas (`/clients`, `/sync`, etc.) e um middleware separado mais leve para as rotas de consulta pública (que usam apenas CPF como identificação).

### FASE 4 — Webhook do Shopify para Confirmação de Uso (Estimativa: 2-3 dias)

**Passo 4.1: Registrar webhook `orders/create` no Shopify**

Via GraphQL Admin API, registrar um webhook para o tópico `ORDERS_CREATE` que aponte para sua API:

```graphql
mutation {
  webhookSubscriptionCreate(
    topic: ORDERS_CREATE
    webhookSubscription: {
      callbackUrl: "https://sua-api.com/api/v1/webhooks/shopify/orders"
      format: JSON
    }
  ) {
    webhookSubscription { id }
    userErrors { field message }
  }
}
```

**Passo 4.2: Criar handler do webhook**

`POST /api/v1/webhooks/shopify/orders`

Este handler recebe o payload do pedido, verifica se algum `discount_code` do pedido corresponde a um cupom da tabela `cupons_resgate`, e marca o cupom como `utilizado`.

A verificação HMAC do Shopify usa o header `X-Shopify-Hmac-Sha256` com o `SHOPIFY_WEBHOOK_SECRET`:

```javascript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyShopifyWebhook(req) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const hash = createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest('base64');
  return timingSafeEqual(Buffer.from(hmac), Buffer.from(hash));
}
```

**Passo 4.3: Rotina de expiração de cupons**

Adicionar um cron job (ex: diário às 01:00) que:
1. Busca cupons com `status = 'criado'` e `expira_em < NOW()`
2. Marca como `expirado`
3. (Opcional) Devolve os pontos ao cliente
4. (Opcional) Deleta o cupom no Shopify via mutation `discountCodeDelete`

### FASE 5 — Front-end: Widget Flutuante (Estimativa: 3-5 dias)

**Passo 5.1: Escolher a abordagem de implementação**

A recomendação é usar **Theme App Extension** do Shopify, que é o método oficial e mais robusto. Como alternativa para implantação rápida, pode-se injetar um snippet JavaScript diretamente no `theme.liquid` da loja.

**Passo 5.2: Componentes do widget**

O widget flutuante deve conter:
1. Botão flutuante fixo (canto inferior direito)
2. Modal/drawer com campo de CPF + botão "Consultar"
3. Tela de resultados: saldo de pontos + cards com opções de resgate
4. Tela de confirmação: código do cupom gerado + botão "Copiar"
5. Tela de histórico: resgates anteriores do cliente

**Passo 5.3: Comunicação Front → API**

Todas as chamadas devem ser feitas via `fetch` para a API hospedada, com headers de Content-Type JSON. O CORS da API deve ser restrito ao domínio da loja (`https://diboatabacaria.com.br`).

### FASE 6 — Testes e Monitoramento (Estimativa: 2-3 dias)

**Passo 6.1:** Testes unitários para `shopifyService.js` (mock das chamadas GraphQL)

**Passo 6.2:** Testes de integração para o fluxo completo de resgate (CPF → pontos → cupom → uso)

**Passo 6.3:** Monitoramento: alertas para falhas na criação de cupons, cupons órfãos (criados no Shopify mas sem registro no banco), e webhooks falhando

---

## 3. ANÁLISE E REFATORAÇÕES NECESSÁRIAS

### 3.1 Correções de Segurança (PRIORIDADE ALTA)

**CORS restritivo:**
```javascript
// DE:
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// PARA:
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('CORS bloqueado'));
  },
  methods: ['GET', 'POST', 'PATCH'],
  credentials: true,
}));
```

**Middleware de autenticação por API Key:**
```javascript
// src/middleware/apiKeyAuth.js
export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'API key inválida' } });
  }
  next();
}
```

Aplicar `requireApiKey` em: `GET /clients`, `PATCH /clients/:cpf`, `DELETE /clients/:cpf`, `POST /sync`.

### 3.2 Correções Estruturais

**Webhook controller — remover `await` do res.json:**
```javascript
// DE:
export async function handleBlingVendaWebhook(req, res) {
  await res.status(200).json({ received: true });
  // ...
}

// PARA:
export async function handleBlingVendaWebhook(req, res) {
  res.status(200).json({ received: true });
  // ...
}
```

**Adicionar circuit breaker para chamadas Shopify:**

A chamada para criar cupom no Shopify pode falhar. Implementar retry com backoff exponencial e registrar falhas para reprocessamento manual.

### 3.3 Nova Estrutura de Arquivos (Proposta)

```
src/
├── app.js
├── config/
│   ├── db.js
│   ├── logger.js
│   └── shopify.js                 ← NOVO
├── controllers/
│   ├── clienteController.js
│   ├── fidelidadeController.js    ← NOVO
│   ├── resgateController.js
│   └── webhookController.js       (expandido para Shopify)
├── middleware/
│   ├── apiKeyAuth.js              ← NOVO
│   ├── blingSignature.js
│   ├── errorHandler.js
│   └── shopifySignature.js        ← NOVO
├── repository/
│   ├── clienteRepository.js
│   ├── cupomRepository.js         ← NOVO
│   └── vendaRepository.js
├── routes/
│   ├── clienteRoutes.js
│   ├── fidelidadeRoutes.js        ← NOVO
│   └── webhookRoutes.js           (expandido)
├── services/
│   ├── clienteService.js
│   ├── fidelidadeService.js       ← NOVO
│   ├── resgateService.js          (refatorado)
│   ├── shopifyService.js          ← NOVO
│   └── routine/
└── validators/
    └── index.js
```

---

## 4. SESSÃO DE PERGUNTAS (Q&A)

Antes de codificar, as seguintes questões precisam ser respondidas:

**Negócio:**
1. Qual é a taxa de conversão pontos → reais? (ex: 20 pontos = R$1,00? 10 pontos = R$1,00?)
2. As opções de resgate são fixas (200pts, 500pts, etc.) ou o cliente pode resgatar qualquer quantidade?
3. Existe um valor mínimo de compra para usar o cupom de desconto?
4. O cupom deve ter data de expiração? Se sim, quantos dias?
5. Se o cupom expirar sem uso, os pontos devem ser devolvidos ao cliente?
6. Um cliente pode ter mais de um cupom ativo ao mesmo tempo?
7. O cupom se aplica a todos os produtos ou há exclusões (ex: promoções)?

**Técnico:**
8. A API está hospedada onde? (VPS, AWS, Render, Railway, etc.) — isso afeta a configuração de HTTPS e webhooks.
9. O domínio do Shopify é `diboatabacaria.myshopify.com` ou há um domínio customizado configurado?
10. O front-end da loja usa tema padrão do Shopify (Dawn, etc.) ou tema customizado? Já há algum Theme App Extension?
11. Você deseja que o widget do front-end seja implementado como Theme App Extension (requer build com Shopify CLI) ou como snippet injetado no Liquid?
12. Há previsão de volume de resgates? (10/dia? 100/dia?) — afeta o rate limit da API Shopify.
13. O plano do Shopify da loja é qual? (Basic, Shopify, Advanced, Plus?) — afeta limites de API.

---

## 5. DIAGRAMA DE FLUXO DA INTEGRAÇÃO

```
┌─────────────┐     1. CPF      ┌──────────────┐
│  FRONT-END  │ ──────────────→ │   API DIBOA  │
│  (Widget    │                 │  (Express)   │
│   Shopify)  │ ←────────────── │              │
│             │  2. Saldo +     │              │
│             │     Opções      │              │
│             │                 │              │
│             │  3. Resgatar    │              │     4. GraphQL
│             │ ──────────────→ │              │ ─────────────────→ ┌──────────────┐
│             │                 │  - Valida    │                    │  SHOPIFY API  │
│             │                 │  - Debita    │ ←───────────────── │  (Admin)      │
│             │ ←────────────── │  - Registra  │  5. Cupom criado  │              │
│             │  6. Código do   │              │                    │              │
│             │     cupom       │              │                    │              │
│             │                 │              │                    │              │
│  7. Cliente │                 │              │  8. Webhook        │              │
│  usa cupom  │ ──────────────→ │              │     orders/create  │              │
│  no checkout│                 │              │ ←───────────────── │              │
│             │                 │  9. Marca    │                    │              │
│             │                 │     como     │                    │              │
│             │                 │     usado    │                    │              │
└─────────────┘                 └──────────────┘                    └──────────────┘
```

---

## 6. ENDPOINTS SHOPIFY UTILIZADOS

| Ação | API | Endpoint/Mutation | Scope Necessário |
|------|-----|-------------------|------------------|
| Criar cupom de desconto | GraphQL Admin | `discountCodeBasicCreate` | `write_discounts` |
| Deletar cupom expirado | GraphQL Admin | `discountCodeDelete` | `write_discounts` |
| Consultar cupom | GraphQL Admin | `codeDiscountNodeByCode` | `read_discounts` |
| Receber pedido criado | Webhook | `ORDERS_CREATE` | `read_orders` |
| Registrar webhook | GraphQL Admin | `webhookSubscriptionCreate` | `read_orders` |

---

## 7. RELATÓRIO PARA HANDOFF — INSTRUÇÕES PARA OUTRO AGENTE DE IA

### CONTEXTO GERAL

Você está trabalhando em um projeto chamado **Diboa Cashback**, que é uma API de programa de fidelidade por pontos para a loja Shopify https://diboatabacaria.com.br. A API é escrita em Node.js com Express 5 (ESM modules), MySQL como banco de dados, e atualmente integra com o ERP Bling para capturar vendas.

O objetivo é adicionar integração com o Shopify para que, quando um cliente resgatar pontos, a API crie automaticamente um cupom de desconto único na loja Shopify.

### STACK E DEPENDÊNCIAS

- Runtime: Node.js (ESM — `"type": "module"` no package.json)
- Framework: Express 5.2
- Banco: MySQL (mysql2/promise com pool de conexões)
- Segurança: Helmet, express-rate-limit, HMAC para webhooks
- Validação: cpf-cnpj-validator
- Padrão arquitetural: Routes → Controllers → Services → Repositories

### ETAPA 1 — CRIAR O SERVIÇO SHOPIFY

**Arquivo:** `src/services/shopifyService.js`

**Tarefa:** Implementar um módulo que encapsula chamadas à Shopify Admin GraphQL API (versão 2026-04). O módulo deve exportar duas funções:

- `criarCupomDesconto({ titulo, codigo, valorDesconto, dataExpiracao })` — executa a mutation `discountCodeBasicCreate` com `usageLimit: 1`, `appliesOncePerCustomer: true`, e retorna `{ shopifyDiscountId, codigoCupom }`.
- `deletarCupom(shopifyDiscountId)` — executa a mutation `discountCodeDelete`.

Variáveis de ambiente necessárias: `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`.

O endpoint GraphQL é `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json` com header `X-Shopify-Access-Token`.

Tratar erros da API (campo `userErrors` na resposta) e lançar `AppError` customizado.

Gerar códigos de cupom no formato `DIBOA-XXXXXXXX` onde X são caracteres hexadecimais aleatórios (usar `crypto.randomBytes`).

### ETAPA 2 — CRIAR O REPOSITÓRIO DE CUPONS

**Arquivo:** `src/repository/cupomRepository.js`

**Tarefa:** Criar funções de acesso à tabela `cupons_resgate` (SQL de criação no relatório acima):

- `insertCupom(conn, { clienteId, cpf, pontosResgatados, valorDesconto, codigoCupom, shopifyDiscountId, expiraEm })` — INSERT retornando o id
- `findByCodigo(codigo)` — busca por código do cupom
- `marcarComoUtilizado(conn, codigo)` — UPDATE status = 'utilizado', utilizado_em = NOW()
- `findExpirados()` — SELECT onde status = 'criado' AND expira_em < NOW()
- `marcarComoExpirado(conn, id)` — UPDATE status = 'expirado'
- `findAtivosByClienteId(clienteId)` — SELECT cupons com status = 'criado'

Seguir o mesmo padrão dos repositórios existentes (`clienteRepository.js`): aceitar `conn` como primeiro parâmetro para transações, usar `pool` direto para consultas read-only.

### ETAPA 3 — CRIAR O SERVIÇO DE FIDELIDADE

**Arquivo:** `src/services/fidelidadeService.js`

**Tarefa:** Implementar a lógica de negócio do programa de fidelidade.

**Função `consultarSaldo(rawCpf)`:**
1. Validar CPF com `validateCpf` de `src/validators/index.js`
2. Buscar cliente com `clienteRepo.findByCpf(cpf)`
3. Lançar `NotFoundError` se não encontrado
4. Calcular opções de resgate disponíveis baseado no saldo (usar constante de configuração para a tabela de conversão)
5. Buscar cupons ativos do cliente
6. Retornar `{ cliente: { nome, pontos }, opcoes: [...], cuponsAtivos: [...] }`

**Função `resgatarPontos(rawCpf, pontosParaResgatar)`:**
1. Validar CPF e pontos
2. Obter conexão do pool, iniciar transação
3. Buscar cliente com `findByCpfForUpdate` (row lock)
4. Verificar saldo >= pontos solicitados
5. Calcular valor do desconto em reais (pontos × taxa de conversão)
6. Debitar pontos com `deductPontos`
7. Registrar em `historico_resgates`
8. Chamar `shopifyService.criarCupomDesconto(...)` 
9. Registrar em `cupons_resgate`
10. Commit
11. Se falha na etapa 8, rollback e relançar erro
12. Retornar `{ codigoCupom, valorDesconto, expiraEm }`

**Constante de configuração (pode ficar no topo do arquivo ou em arquivo separado):**
```javascript
export const TABELA_CONVERSAO = {
  PONTOS_POR_REAL: 20,
  OPCOES_RESGATE: [
    { pontos: 200, valor: 10 },
    { pontos: 500, valor: 25 },
    { pontos: 1000, valor: 50 },
    { pontos: 2000, valor: 100 },
  ],
  DIAS_EXPIRACAO: 30,
};
```

### ETAPA 4 — CRIAR CONTROLLER E ROTAS DE FIDELIDADE

**Arquivo:** `src/controllers/fidelidadeController.js`

Duas funções:
- `consultarSaldo(req, res, next)` — chama `fidelidadeService.consultarSaldo(req.params.cpf)`, retorna 200 com resultado
- `resgatarPontos(req, res, next)` — chama `fidelidadeService.resgatarPontos(req.body.cpf, req.body.pontos)`, retorna 201 com `{ codigoCupom, valorDesconto, expiraEm }`

**Arquivo:** `src/routes/fidelidadeRoutes.js`

Duas rotas:
- `GET /fidelidade/:cpf` → `consultarSaldo`
- `POST /fidelidade/resgate` → `resgatarPontos`

Registrar no `app.js`: `app.use('/api/v1', fidelidadeRoutes)`

### ETAPA 5 — MIDDLEWARE DE AUTENTICAÇÃO

**Arquivo:** `src/middleware/apiKeyAuth.js`

Middleware que verifica header `X-Api-Key` contra `process.env.ADMIN_API_KEY`. Retorna 401 se inválido. Aplicar nas rotas administrativas de `clienteRoutes.js`.

**Arquivo:** `src/middleware/shopifySignature.js`

Middleware que verifica HMAC SHA-256 dos webhooks Shopify. O header é `X-Shopify-Hmac-Sha256`, o segredo é `SHOPIFY_WEBHOOK_SECRET`, e a comparação usa `timingSafeEqual` com encoding base64 (diferente do Bling que usa hex). Reutilizar o padrão de `blingSignature.js` adaptando.

### ETAPA 6 — WEBHOOK HANDLER PARA PEDIDOS SHOPIFY

**Arquivo:** Expandir `src/routes/webhookRoutes.js` e `src/controllers/webhookController.js`

Nova rota: `POST /api/v1/webhooks/shopify/orders` protegida pelo `shopifySignature` middleware.

O handler deve:
1. Responder 200 imediatamente
2. Extrair `discount_codes` do payload do pedido (campo `discount_codes` é um array de objetos com campo `code`)
3. Para cada código, verificar se existe na tabela `cupons_resgate` com status `criado`
4. Se encontrar, marcar como `utilizado` dentro de uma transação

### ETAPA 7 — CRON DE EXPIRAÇÃO DE CUPONS

**Arquivo:** Adicionar ao `app.js` um novo cron job:

```javascript
cron.schedule('0 1 * * *', async () => {
  // Buscar cupons expirados
  // Marcar como expirado
  // (Opcional) Devolver pontos
  // (Opcional) Deletar cupom no Shopify
});
```

### ETAPA 8 — AJUSTES DE SEGURANÇA NO app.js

1. Restringir CORS para aceitar apenas `https://diboatabacaria.com.br` e domínios permitidos
2. O `express.json()` já captura `rawBody` para webhooks — expandir o path check para incluir webhooks do Shopify
3. Excluir rota de webhook Shopify do rate limiter global (já feito para Bling)

### ETAPA 9 — FRONT-END (WIDGET FLUTUANTE)

**Abordagem recomendada:** Snippet JS injetado via `theme.liquid` (mais rápido de implementar).

Criar um arquivo JavaScript self-contained que:
1. Injeta um botão flutuante no DOM (position: fixed, bottom-right)
2. Ao clicar, abre um modal/drawer
3. Modal tem input de CPF mascarado (XXX.XXX.XXX-XX) + botão "Consultar"
4. Chama `GET https://api-diboa.com/api/v1/fidelidade/{cpf}`
5. Exibe saldo e cards com opções de resgate
6. Ao selecionar opção, chama `POST https://api-diboa.com/api/v1/fidelidade/resgate`
7. Exibe código do cupom com botão "Copiar para área de transferência"
8. Animações suaves (slide-in do modal, fade dos resultados)

O CSS deve ser escopo (scoped) para não conflitar com o tema da loja. Usar um prefixo como `.diboa-*` em todos os seletores.

### ETAPA 10 — TESTES

**Testes unitários (usando test runner nativo do Node.js):**
- `shopifyService.test.js` — mock de `fetch`, verificar que mutation é montada corretamente, tratar erros
- `fidelidadeService.test.js` — mock dos repositories, testar fluxo de resgate completo incluindo rollback

**Testes de integração:**
- Fluxo completo: consultar → resgatar → verificar cupom no banco → simular webhook de pedido → verificar que cupom foi marcado como usado

### CHECKLIST FINAL DE IMPLEMENTAÇÃO

- [ ] Variáveis de ambiente do Shopify configuradas
- [ ] Tabela `cupons_resgate` criada no MySQL
- [ ] `shopifyService.js` implementado e testado
- [ ] `cupomRepository.js` implementado
- [ ] `fidelidadeService.js` implementado com transações
- [ ] `fidelidadeController.js` e `fidelidadeRoutes.js` criados
- [ ] `apiKeyAuth.js` implementado e aplicado nas rotas admin
- [ ] `shopifySignature.js` implementado
- [ ] Handler de webhook `orders/create` do Shopify implementado
- [ ] Cron de expiração de cupons implementado
- [ ] CORS restrito ao domínio da loja
- [ ] rawBody capturado para path de webhooks Shopify
- [ ] Webhook `ORDERS_CREATE` registrado na Shopify via GraphQL
- [ ] Widget front-end implementado e injetado no tema
- [ ] Testes unitários e de integração escritos
- [ ] Deploy e teste end-to-end em ambiente de staging