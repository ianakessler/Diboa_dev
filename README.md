# Diboa Cashback — Documentação Técnica Completa

> **Propósito deste documento:** servir como especificação única e suficiente para que um agente LLM reconstrua uma versão profissional e correta deste sistema. Leia integralmente antes de gerar qualquer código.

---

## 1. Visão Geral do Projeto

**Diboa Cashback** é uma API REST (Node.js / Express) que gerencia um programa de fidelidade baseado em pontos para uma loja física. A cada R$1,00 em compras confirmadas no ERP Bling, o cliente acumula 1 ponto. Os pontos podem ser resgatados pelo operador da loja.

### Fluxo Principal

```
Bling (ERP) ──webhook POST──▶ API Diboa ──▶ MySQL
                                  │
              cron (23:59) ──sync──┘
                                  │
Operador (frontend) ◀──REST──────┘
```

**Estratégia dupla de ingestão (webhook + rotina diária):**

1. **Tempo real (webhook):** O Bling envia um POST quando um pedido de venda é confirmado. A API recebe, registra a venda e credita os pontos imediatamente.
2. **Rede de segurança (rotina diária):** Todo dia às 23:59 (via cron/node-cron), a rotina `syncRoutine` puxa todos os pedidos do dia na API do Bling e processa os que ainda não foram registrados. Isso cobre falhas de entrega de webhook, downtime temporário da API, etc.
3. O operador da loja consulta clientes, saldos e efetua resgates via frontend (HTML/CSS/EJS, futuro React).

Ambos os fluxos são **idempotentes** — o `bling_pedido_id` UNIQUE garante que a mesma venda nunca credita pontos duas vezes, independente de ter entrado via webhook ou rotina.

### Stack

| Camada      | Tecnologia                        |
|-------------|-----------------------------------|
| Runtime     | Node.js (ESM)                     |
| Framework   | Express 5                         |
| Banco       | MySQL 8 (mysql2/promise)          |
| ERP         | Bling API v3 (OAuth 2.0)          |
| Frontend    | HTML/CSS/EJS (migração React planejada) |
| Deploy      | VPS própria (Linux)               |

---

## 2. Arquitetura de Camadas

```
src/
├── app.js                    # Bootstrap Express, middlewares, rotas
├── config/
│   ├── db.js                 # Pool de conexões MySQL
│   └── logger.js             # Logger customizado (console)
├── controllers/              # Recebem req/res, delegam para services
│   ├── clienteController.js
│   ├── resgateController.js
│   └── syncController.js
├── errors/
│   └── AppError.js           # Hierarquia de erros HTTP
├── middleware/
│   └── errorHandler.js       # Global error handler
├── repository/               # Queries SQL puras (acesso a dados)
│   ├── clienteRepository.js
│   └── vendaRepository.js
├── routes/                   # Definição de rotas Express
│   ├── clienteRoutes.js
│   └── resgateRoutes.js
├── services/                 # Lógica de negócio
│   ├── clienteService.js
│   ├── resgateService.js
│   └── routine/
│       ├── blingApi.js       # Wrapper HTTP para Bling API
│       ├── blingAuth.js      # OAuth 2.0 (token management)
│       └── syncRoutine.js    # Rotina de sincronização de pedidos
└── validators/
    └── index.js              # Validação CPF e pontos
```

**Convenção:** Controller → Service → Repository. Controllers nunca acessam o banco diretamente. Repositories nunca contêm lógica de negócio.

---

## 3. Modelo de Dados (MySQL)

### Tabelas

```sql
-- O banco já existe e está criado. Nenhum registro existe ainda.

CREATE TABLE clientes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nome          VARCHAR(255) NOT NULL,
  numero_documento VARCHAR(14) NOT NULL UNIQUE,  -- CPF (somente dígitos)
  client_id     BIGINT,                          -- ID do contato no Bling
  pontos        DECIMAL(10,2) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE vendas (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  bling_pedido_id BIGINT UNIQUE,                 -- ID do pedido no Bling
  numero_pedido   VARCHAR(50),
  data_venda      DATE,
  valor_total     DECIMAL(10,2),
  cliente_id      BIGINT,                        -- FK lógica → clientes.client_id
  processada      TINYINT(1) DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE historico_resgates (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id        BIGINT,                      -- FK lógica → clientes.client_id
  pontos_resgatados INT NOT NULL,
  data_resgate      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bling_tokens (
  id             INT PRIMARY KEY DEFAULT 1,      -- Sempre 1 (singleton)
  access_token   TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  expires_at     BIGINT NOT NULL,                -- Timestamp ms (Date.now())
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Observações sobre FK

O projeto atual **não usa FOREIGN KEYs reais** no banco — as relações são lógicas via `client_id` (ID do Bling). A versão profissional **deve** implementar FKs reais com `ON DELETE CASCADE` / `ON DELETE RESTRICT` conforme a regra de negócio.

---

## 4. Rotas da API

Prefixo base: `/api/v1`

### Clientes

| Método | Rota                          | Descrição                       | Body / Params               |
|--------|-------------------------------|----------------------------------|-----------------------------|
| GET    | `/clients`                    | Lista todos os clientes          | —                           |
| GET    | `/clients/cpf/:cpf`          | Busca cliente por CPF            | `cpf` (param)               |
| POST   | `/editClient`                 | Edita nome/pontos de um cliente  | `{ cpf, pontos, nome }`     |
| DELETE | `/clients/:cpf`               | Remove cliente por CPF           | `cpf` (param)               |

### Histórico

| Método | Rota                          | Descrição                        |
|--------|-------------------------------|----------------------------------|
| GET    | `/historico/resgates/:cpf`    | Histórico de resgates do cliente |
| GET    | `/historico/compras/:cpf`     | Histórico de compras (vendas)    |

### Resgates

| Método | Rota          | Descrição             | Body                 |
|--------|---------------|-----------------------|----------------------|
| POST   | `/resgates`   | Efetua resgate de pontos | `{ cpf, pontos }` |

### Sincronização (rotina diária — rede de segurança)

| Método | Rota    | Descrição                                                        |
|--------|---------|------------------------------------------------------------------|
| POST   | `/sync` | Puxa todos os pedidos do dia no Bling e processa os pendentes    |

> Executada automaticamente via cron às 23:59. Também pode ser chamada manualmente pelo operador. Garante que nenhuma venda do dia fique sem pontuar, mesmo se o webhook falhar.

### Webhook Bling (A IMPLEMENTAR)

| Método | Rota                     | Descrição                                   |
|--------|--------------------------|---------------------------------------------|
| POST   | `/webhooks/bling/vendas` | Recebe notificações de venda confirmada      |

### OAuth Bling (A IMPLEMENTAR como rotas)

| Método | Rota                      | Descrição                                     |
|--------|---------------------------|-----------------------------------------------|
| GET    | `/auth/bling`             | Redireciona para tela de autorização do Bling |
| GET    | `/auth/bling/callback`    | Recebe o `code` e troca por tokens            |

### Utilitário

| Método | Rota      | Descrição    |
|--------|-----------|--------------|
| GET    | `/health` | Health check |

---

## 5. Fluxo OAuth 2.0 com o Bling

O Bling usa Authorization Code Grant. Os tokens **ainda não existem** no banco, então o fluxo inicial deve ser executado manualmente uma vez.

### Passo a passo

1. **Configurar app no Bling:** Registrar aplicativo em `https://www.bling.com.br/Api/v3/oauth/applications`, definir `redirect_uri` (ex: `https://seudominio.com/api/v1/auth/bling/callback`).
2. **Gerar URL de autorização:** `GET /auth/bling` → redireciona o navegador para `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=...&redirect_uri=...`.
3. **Receber callback:** Bling redireciona para `redirect_uri?code=XXXX`. A rota `/auth/bling/callback` pega o `code` e chama `exchangeCodeForTokens(code, redirectUri)`.
4. **Tokens salvos no banco:** `access_token`, `refresh_token` e `expires_at` são armazenados na tabela `bling_tokens` (id=1).
5. **Renovação automática:** `getValidAccessToken()` verifica `expires_at`. Se expirado (com margem de 5 min), usa `refresh_token` para obter novo par de tokens.

### Variáveis de ambiente necessárias

```env
CLIENT_ID=xxxxxxxxxxxxxxx
CLIENT_SECRET=xxxxxxxxxxxxxxx
BLING_REDIRECT_URI=xxxxxxxxxx
```

---

## 6. Webhook do Bling — Especificação

### Configuração no Bling

Cadastrar webhook no painel do Bling apontando para `POST https://seudominio.com/api/v1/webhooks/bling/vendas` com o evento **"Pedidos de Venda"** (confirmação / alteração de situação).

### Payload esperado (Bling v3)

```json
{
  "evento": "pedidos.vendas.alteracao",
  "dados": {
    "id": 12345678,
    "numero": "1042",
    "data": "2025-07-01",
    "situacao": {
      "id": 9,
      "valor": 1
    },
    "total": 157.90,
    "contato": {
      "id": 98765,
      "nome": "João Silva",
      "numeroDocumento": "123.456.789-00"
    }
  }
}
```

### Lógica de processamento

1. Validar que `situacao.valor === 1` (confirmado).
2. Extrair e validar CPF do contato.
3. Fazer upsert do cliente (INSERT IGNORE).
4. Inserir a venda (INSERT IGNORE pelo `bling_pedido_id` para idempotência).
5. Creditar `valor_total` como pontos ao cliente (`pontos += valor_total`, pois R$1 = 1 ponto).
6. Marcar venda como `processada = 1`.
7. Responder `200 OK` rapidamente ao Bling (idealmente processar em background).

### Segurança

- Validar assinatura/token do webhook se o Bling fornecer header de verificação.
- Rate-limit a rota de webhook.
- Retornar 200 mesmo em erro interno (para o Bling não ficar reenviando), mas logar o erro.

---

## 7. Regras de Negócio

| Regra | Descrição |
|-------|-----------|
| Conversão de pontos | R$1,00 em vendas confirmadas = 1 ponto |
| Resgate | Mínimo: 1 ponto. Deve ser inteiro positivo. Saldo não pode ficar negativo. |
| Identificação | Cliente é identificado unicamente por CPF (somente dígitos). |
| Idempotência de vendas | `bling_pedido_id` é UNIQUE — a mesma venda nunca credita pontos duas vezes, independente de ter entrado via webhook ou rotina diária. |
| Ingestão dupla | Webhook para tempo real + rotina diária às 23:59 como fallback. Ambos usam INSERT IGNORE, então não há risco de duplicação. |
| Processamento | Venda entra com `processada = 0`, credita pontos, vira `processada = 1`. |
| Transações | Resgate e crédito de pontos devem usar transações com `SELECT ... FOR UPDATE` para evitar race conditions. |

---

## 8. Revisão Técnica — Bugs e Problemas Encontrados

### 🔴 Críticos

| # | Arquivo | Problema | Correção |
|---|---------|----------|----------|
| 1 | `config/db.js` | **Credenciais hardcoded** (usuário, senha, host, banco). Sem uso de variáveis de ambiente. A senha do banco está em texto claro no código-fonte. | Mover para `.env` e ler via `process.env`. Nunca commitar credenciais. |
| 2 | `services/clienteService.js` | Função `updateClientInfos()` está **incompleta** — contém código cortado (`const response = await`). Causa syntax error se chamada. | Remover ou implementar completamente. |
| 3 | `services/clienteService.js` → `deleteByCpf` | Usa `findByCpf()` (sem lock) dentro de transação em vez de `findByCpfForUpdate()`. **Race condition**: outro processo pode modificar/deletar o registro entre o SELECT e o DELETE. | Usar `findByCpfForUpdate(conn, cpf)` passando a conexão da transação. |
| 4 | Nenhuma rota OAuth existe | As funções `exchangeCodeForTokens()` e `getAuthorizationUrl()` existem no service mas **não há rotas** para executar o fluxo. Sem isso, é impossível obter tokens e toda integração com Bling falha. | Criar rotas `/auth/bling` e `/auth/bling/callback`. |
| 5 | Nenhuma rota de webhook existe | Não há endpoint para receber webhooks do Bling. O sistema depende de chamar `/sync` manualmente (polling), o que é frágil e não escala. | Implementar `POST /webhooks/bling/vendas`. |

### 🟡 Importantes

| # | Arquivo | Problema | Correção |
|---|---------|----------|----------|
| 6 | `app.js` | `import 'dotenv/config'` duplicado (linhas 1 e 8). | Remover duplicata. |
| 7 | `app.js` | `cors({ origin: "*" })` aceita qualquer origem. Inseguro em produção. | Configurar domínios permitidos via `.env`. |
| 8 | `routes/clienteRoutes.js` | `POST /editClient` deveria ser `PUT /clients/:cpf` ou `PATCH /clients/:cpf` — não é RESTful. | Adequar ao padrão REST. |
| 9 | `repository/clienteRepository.js` → `insertResgate` | Tem `try/catch` que apenas faz `throw error` — redundante e polui stack trace. | Remover try/catch desnecessário. |
| 10 | `services/clienteService.js` → `montarHistorico` e `getHistory` | Mesmo padrão de try/catch redundante (catch faz apenas re-throw). | Remover. Deixar o erro propagar naturalmente. |
| 11 | `services/clienteService.js` → `montarHistorico` | Não verifica se `client` é `null` antes de acessar `client.client_id`. Se CPF não existe, causa `TypeError: Cannot read property 'client_id' of null`. | Adicionar verificação `if (!client) throw new NotFoundError(...)`. |
| 12 | `services/clienteService.js` → `getHistory` | Mesmo problema do item 11 — `client` pode ser `null`. | Idem. |
| 13 | `blingAuth.js` | Usa `dotenv.config({ path: '.env.local' })` separado do restante do app (que usa `dotenv/config` para `.env`). Confuso e propenso a erro de config. | Unificar: usar um único `.env` ou um `.env` + `.env.local` com uma estratégia clara. |
| 14 | `vendaRepository.js` → `processarVendasPendentes` | O `UPDATE clientes JOIN vendas` não filtra por data ou batch, processa **todas** as vendas pendentes de uma vez. Em cenário de falha parcial, pode reprocessar. | Considerar processar por batch com IDs específicos. |

### 🟢 Melhorias (code quality)

| # | Arquivo | Problema |
|---|---------|----------|
| 15 | Vários (`clienteController`, `clienteService`, `vendaRepository`, `resgateService`) | `console.log` de debug espalhados (`"AAAAA: "`, `"[DEBUG]"`, `"Cliente_id recebdio = "`). Devem ser removidos ou substituídos por `logger.debug()`. |
| 16 | `blingAuth.js` | `console.log("CLIENTE_ID: ", client_id)` — loga credenciais no console. | 
| 17 | `config/logger.js` | Logger é minimal (apenas console). Para produção em VPS, considerar winston ou pino com rotação de arquivo. |
| 18 | `package.json` | Não há script de lint, nem configuração de eslint/prettier. |
| 19 | Projeto | Não há `.env.example` documentando as variáveis necessárias. |
| 20 | Projeto | Não há Dockerfile nem docker-compose para padronizar o ambiente. |
| 21 | Projeto | `node_modules` está incluído no zip (deveria estar no `.gitignore`). |

---

## 9. Variáveis de Ambiente Necessárias

```env
# Servidor
PORT=3000
NODE_ENV=production

# Banco de Dados
DB_HOST=localhost
DB_USER=diboa_app
DB_PASSWORD=<senha_segura>
DB_NAME=diboa_dev
DB_CONNECTION_LIMIT=10

# Bling OAuth
CLIENT_ID=<bling_client_id>
CLIENT_SECRET=<bling_client_secret>
BLING_REDIRECT_URI=https://seudominio.com/api/v1/auth/bling/callback

# CORS
CORS_ORIGIN=https://seudominio.com

# Webhook (opcional — secret para validar payloads do Bling)
BLING_WEBHOOK_SECRET=<secret_se_disponivel>
```

---

## 10. Instruções para o Agente LLM que vai Refatorar

### O que manter

- Arquitetura de camadas (Controller → Service → Repository) — está correta.
- Hierarquia de erros customizados (`AppError`, `NotFoundError`, etc.) — bem feita.
- Uso de transações com `SELECT ... FOR UPDATE` no resgate — correto.
- Validação de CPF com `cpf-cnpj-validator` — correto.
- `INSERT IGNORE` para idempotência de clientes e vendas — correto.
- `syncRoutine` como rotina diária de reconciliação — manter e agendar via cron.

### O que refatorar

1. **Mover todas as credenciais para `.env`** e nunca hardcodar.
2. **Remover** a função incompleta `updateClientInfos`.
3. **Remover** todos os `console.log` de debug e substituir por `logger.debug()`.
4. **Corrigir** `deleteByCpf` para usar `findByCpfForUpdate` com a conexão da transação.
5. **Adicionar null-check** em `montarHistorico` e `getHistory` antes de acessar `client.client_id`.
6. **Remover** try/catch redundantes (que só fazem re-throw).
7. **Criar rotas OAuth** (`GET /auth/bling`, `GET /auth/bling/callback`).
8. **Criar rota de webhook** (`POST /webhooks/bling/vendas`) com a lógica descrita na seção 6.
9. **Converter `POST /editClient`** para `PUT /clients/:cpf` ou `PATCH /clients/:cpf`.
10. **Remover `import 'dotenv/config'` duplicado** no `app.js`.
11. **Restringir CORS** para origens específicas.
12. **Unificar** estratégia de dotenv (remover `dotenv.config({ path: '.env.local' })` isolado no `blingAuth.js`).

### O que adicionar

1. **Rota de webhook Bling** — ver seção 6 para spec completa.
2. **Rotas OAuth** — ver seção 5 para fluxo completo.
3. **Agendador da rotina diária** — usar `node-cron` (ou crontab do sistema) para executar `POST /sync` todo dia às 23:59. Exemplo com node-cron: `cron.schedule('59 23 * * *', () => executarRotina())`. A rotina é idempotente, então não há risco de duplicar pontos.
4. **`.env.example`** com todas as variáveis documentadas.
4. **Dockerfile** e **docker-compose.yml** (Node + MySQL).
5. **Rate limiting** global (express-rate-limit) e especialmente na rota de webhook.
6. **Helmet** para headers de segurança.
7. **Testes unitários** pelo menos para services e validators.
8. **ESLint + Prettier** configurados.
9. **Graceful shutdown** — fechar o pool MySQL e o server ao receber SIGTERM.
10. **Logger de produção** (winston/pino com arquivo rotativo).
11. **Middleware de validação de body** (express-validator ou zod) nos controllers, em vez de validar só no service.

### O que NÃO alterar

- O schema do banco de dados **já existe e está vazio**. Não emita `CREATE TABLE` — apenas documente a estrutura e assuma que as tabelas existem.
- A tabela `bling_tokens` está vazia — o fluxo OAuth **precisa ser executado** pelo operador na primeira vez.
- A regra de R$1 = 1 ponto é definitiva.

---

## 11. Exemplo de Implementação — Webhook Handler

Pseudocódigo para referência do agente:

```javascript
// POST /webhooks/bling/vendas
async function handleBlingWebhook(req, res) {
  // 1. Responder 200 imediatamente (Bling espera resposta rápida)
  res.status(200).json({ received: true });

  // 2. Processar em background
  try {
    const { evento, dados } = req.body;

    // Ignorar eventos que não são confirmação
    if (dados?.situacao?.valor !== 1) return;

    const doc = dados.contato?.numeroDocumento?.replace(/\D/g, '');
    if (!doc || !cpfValidator.isValid(doc)) return;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Upsert cliente
      await clienteRepo.upsertIgnore(conn, {
        nome: dados.contato.nome,
        cpf: doc,
        clienteId: dados.contato.id,
      });

      // Insert venda (idempotente via bling_pedido_id UNIQUE)
      await vendaRepo.batchInsertIgnore(conn, [[
        dados.id,
        dados.numero,
        dados.data,
        dados.total,
        dados.contato.id,
      ]]);

      // Creditar pontos para esta venda específica
      await conn.query(
        `UPDATE clientes c
         JOIN vendas v ON c.client_id = v.cliente_id
         SET c.pontos = c.pontos + v.valor_total
         WHERE v.bling_pedido_id = ? AND v.processada = 0`,
        [dados.id]
      );

      await conn.query(
        'UPDATE vendas SET processada = 1 WHERE bling_pedido_id = ? AND processada = 0',
        [dados.id]
      );

      await conn.commit();
      logger.info('Webhook processado', { pedidoId: dados.id, cpf: doc });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    logger.error('Erro ao processar webhook Bling', { error: error.message });
    // NÃO re-throw — já respondemos 200
  }
}
```

---

## 12. Checklist de Validação

Antes de considerar a refatoração concluída, verificar:

- [ ] `npm start` sobe sem erros
- [ ] `GET /health` retorna `{ status: "ok" }`
- [ ] `GET /auth/bling` redireciona para tela de login do Bling
- [ ] Após autorização, tokens são salvos em `bling_tokens`
- [ ] `POST /webhooks/bling/vendas` com payload de teste insere cliente + venda + credita pontos
- [ ] `POST /webhooks/bling/vendas` com mesmo `bling_pedido_id` NÃO credita pontos duplicados
- [ ] Rotina diária (cron 23:59) processa vendas que o webhook não pegou, sem duplicar pontos
- [ ] `POST /resgates` com CPF válido e saldo suficiente debita corretamente
- [ ] `POST /resgates` com saldo insuficiente retorna 422
- [ ] `DELETE /clients/:cpf` remove o cliente
- [ ] Nenhuma credencial aparece no código-fonte (grep por senhas, secrets)
- [ ] Nenhum `console.log` de debug no código final
- [ ] `.env.example` existe com todas as variáveis documentadas