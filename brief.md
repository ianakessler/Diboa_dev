# Brief de Implementação — Integração Bling (Diboa Cashback v2)

> Documento de trabalho para um agente de IA executar a refatoração da integração com o **Bling ERP** dentro da migração v1 → v2 do sistema de cashback Diboa. Leia o documento inteiro antes de escrever qualquer linha de código.

---

## 0. Como você (agente) deve trabalhar

**Regras inegociáveis:**

1. Leia **todo** este brief antes de começar. Siga a ordem das etapas (§6).
2. **Stack e estilo do projeto** (não desvie):
   - Node.js com **ESM** (`"type": "module"` — use `import`/`export`, nunca `require`).
   - `async/await` em tudo. Sem callbacks soltos.
   - Arquitetura em camadas: `routes → controllers → services → repository → MySQL`.
   - Logger central: `import logger from '../config/logger.js'` (use `logger.info/warn/error`, não `console.log`).
   - Erros via classes customizadas de `errors/AppError.js` (`AppError`, `NotFoundError`, `BadRequestError`, `InsufficientBalanceError`).
   - Acesso a dados: pool `mysql2/promise` de `config/db.js`. Transações com `getConnection()` + `beginTransaction/commit/rollback` + `release()`. Use `FOR UPDATE` para travar linhas quando alterar saldo.
   - Idempotência: `INSERT IGNORE` / colunas `UNIQUE`.
3. **Só altere os arquivos listados na §5.** Não toque em nada fora desse escopo sem registrar na seção de dúvidas.
4. Ao concluir cada etapa, marque o checklist e liste arquivos criados/modificados.
5. **Não invente comportamento da API do Bling.** Os fatos canônicos estão na §4 com as fontes oficiais. Se algo não estiver coberto, **pare e pergunte** (§8) — não chute.
6. **Nunca** logue tokens (`access_token`, `refresh_token`) nem o `client_secret`.

---

## 1. Contexto do projeto

O **Diboa Cashback** é uma API REST (Node.js + Express 5 + MySQL) de um programa de fidelidade por pontos. Vendas confirmadas no Bling ERP geram pontos para o cliente (identificado por CPF/CNPJ), que depois resgata pontos por cupons de desconto na loja Shopify.

A v1 funciona, mas está sendo migrada para a v2. As mudanças da v2 **relevantes para a integração Bling** são:

- **CPF/CNPJ é a chave.** O `client_id` (id do contato no Bling) **deixa de ser persistido**. Ele ainda pode ser usado *em memória* durante uma requisição (ex.: resolver CPF → contato → pedidos), mas nunca salvo no banco.
- **Sem rotina de sincronização.** O cron diário que puxava pedidos do Bling some. Todo acúmulo entra por **webhook**.
- **Sem tabela `vendas`.** O histórico de compras passa a ser **montado em tempo real a partir da API do Bling**.

> Este brief cobre **apenas a camada de integração Bling** (auth + cliente HTTP). Os fluxos de domínio (webhook de acúmulo, lotes de pontos, resgate) são outro workstream e dependem de decisões ainda em aberto — não os implemente aqui.

---

## 2. Estado atual (v1) da integração Bling

Arquivos relevantes na v1:

- `src/services/routine/blingAuth.js` — OAuth 2.0 (authorization_code + refresh_token), tokens salvos em `bling_tokens`.
- `src/services/routine/blingApi.js` — `blingFetch` (wrapper autenticado), `fetchPedidoById`, `fetchContatoById`, `fetchPedidosVendas` (usado pela rotina).
- `src/services/routine/syncRoutine.js` — rotina de pull diário. **Será removida** (fora do escopo deste brief; apenas não dependa dela).
- `src/controllers/authController.js` — endpoints OAuth do Bling.
- Tabela `bling_tokens` — criada manualmente na v1, com `access_token VARCHAR(500)`.

Problemas da v1 a corrigir nesta refatoração:

- Usa **tokens opacos**, que o Bling **descontinuou** (ver §4).
- `access_token VARCHAR(500)` **não cabe** um JWT (até ~3.000 chars).
- Não há função para resolver **CPF → contato** nem para **listar pedidos por contato** (necessárias para o histórico da v2).
- A pasta `routine/` perde o sentido (não há mais rotina).

---

## 3. Objetivo desta refatoração

1. Migrar a autenticação do Bling para **JWT**.
2. Ampliar o armazenamento do token para caber o JWT.
3. Adicionar funções de **resolução por CPF** e **histórico de pedidos por contato**.
4. Remover a função de pull da rotina e mover a integração para `services/integrations/bling/`.
5. Atualizar os imports de quem consome esses módulos.

A implementação de referência já existe (arquivos entregues): `blingAuth.js`, `blingApi.js` e a migration `003_bling_tokens_jwt.sql`. Sua tarefa é **posicioná-los, integrá-los e validá-los** no projeto, ajustando o que for necessário.

---

## 4. Fatos canônicos da API do Bling (NÃO desvie destes)

Fontes oficiais para conferência:
- Migração JWT: https://developer.bling.com.br/migracao-jwt
- Autenticação/OAuth: https://developer.bling.com.br/bling-api e https://developer.bling.com.br/aplicativos
- Boas práticas (paginação): https://developer.bling.com.br/boas-praticas

### 4.1 Autenticação JWT (obrigatória)

- Tokens **opacos foram descontinuados**; a data de bloqueio total está "em definição". Migre agora.
- Para **receber JWT**, inclua o header `enable-jwt: 1` na requisição `POST /Api/v3/oauth/token` — **tanto na troca do `authorization_code` quanto na renovação via `refresh_token`**. Sem o header, o Bling devolve token opaco.
- Mantenha `enable-jwt: 1` **em todas as requisições** à API (recomendação oficial), não só no endpoint de token.
- Use o token com `Authorization: Bearer {token}` em todas as chamadas autenticadas.
- Erros: `401` = token expirado/inválido → renove via refresh_token (com `enable-jwt: 1`) ou refaça o OAuth. `400` = header malformado → confira o formato `Authorization: Bearer {token}`.

### 4.2 Tamanho do token

- O JWT tem aproximadamente **1.500 a 3.000 caracteres**.
- Consequência prática: a coluna `access_token` **precisa ser `TEXT`** (a v1 estava `VARCHAR(500)` e truncaria o token, quebrando a auth com 401 silencioso). Idem para `refresh_token` por segurança.

### 4.3 Endpoints usados

- Token: `POST /Api/v3/oauth/token` (host historicamente `https://www.bling.com.br`; mantenha configurável por env).
- Autorização: `GET /Api/v3/oauth/authorize`.
- Recursos: base `https://api.bling.com.br/Api/v3`.
- Consultar contato por id: `GET /contatos/{idContato}`.
- Consultar pedido por id: `GET /pedidos/vendas/{idPedido}`.

### 4.4 Resolver CPF/CNPJ → contato

- **Não existe** filtro `numeroDocumento` na *listagem* de contatos.
- Use `GET /contatos?pesquisa={cpf}` — o parâmetro `pesquisa` aceita nome, CPF/CNPJ, e-mail, etc.
- Como a busca é **ampla**, **filtre o resultado pelo documento exato** (só dígitos) para evitar falso positivo antes de usar o contato.

### 4.5 Histórico de pedidos por contato

- `GET /pedidos/vendas?idContato={id}` lista os pedidos do contato.
- **Paginação do Bling:** parâmetros `pagina` (default 1) e `limite` (default 100). Para o histórico completo, **pagine até o fim** (pare quando a página vier com menos itens que `limite`). Use uma trava de segurança de páginas para não fazer loop infinito.

---

## 5. Arquivos no escopo

**Criar / posicionar:**

| Caminho | Origem |
|---|---|
| `src/services/integrations/bling/blingAuth.js` | implementação de referência entregue |
| `src/services/integrations/bling/blingApi.js` | implementação de referência entregue |
| `migrations/003_bling_tokens_jwt.sql` | migration entregue |

**Modificar (apenas os imports / caminhos):**

| Caminho | O que muda |
|---|---|
| `src/controllers/authController.js` | atualizar o import de `services/routine/blingAuth.js` → `services/integrations/bling/blingAuth.js` |
| Qualquer arquivo que importe `services/routine/blingApi.js` | atualizar o caminho para `services/integrations/bling/blingApi.js` |

**Remover (após confirmar que nada mais depende):**

| Caminho | Motivo |
|---|---|
| `src/services/routine/blingApi.js` e `blingAuth.js` | substituídos pelos novos em `integrations/bling/` |
| `fetchPedidosVendas` | era da rotina (não recriar) |

> **Não** remova `syncRoutine.js`/`syncController.js` neste brief — é outro workstream. Só **não dependa** deles e não os importe nos arquivos novos.

---

## 6. Etapas de execução (em ordem)

**ETAPA 1 — Migration do banco**
- [ ] Posicione `migrations/003_bling_tokens_jwt.sql`.
- [ ] Se a tabela `bling_tokens` **já existe** (vinda da v1), rode o `ALTER` (opção B) para `MODIFY access_token TEXT` e `refresh_token TEXT`. Se for banco novo, rode o `CREATE` (opção A).
- [ ] Verifique no schema que `access_token` ficou `TEXT`.

**ETAPA 2 — Posicionar os módulos**
- [ ] Crie a pasta `src/services/integrations/bling/`.
- [ ] Posicione `blingAuth.js` e `blingApi.js` ali.
- [ ] Confira os caminhos relativos dos imports internos (`../../../config/...`, `../../../errors/...`) conforme a profundidade da nova pasta.

**ETAPA 3 — Atualizar consumidores**
- [ ] Faça um grep por `routine/blingAuth` e `routine/blingApi` no projeto.
- [ ] Atualize cada import para `integrations/bling/...`.
- [ ] Garanta que nenhum arquivo novo importe `fetchPedidosVendas` (removida).

**ETAPA 4 — Variáveis de ambiente**
- [ ] Confirme/adicione no `.env` e no `.env.example`:
  - `CLIENT_ID`, `CLIENT_SECRET` (app Bling)
  - `BLING_REDIRECT_URI`
  - (opcionais, têm default) `BLING_API_BASE_URL`, `BLING_TOKEN_URL`, `BLING_AUTHORIZE_URL`
- [ ] Confirme no painel do app no Bling que o **escopo** concede leitura de **contatos** e **pedidos de venda**.

**ETAPA 5 — Limpeza**
- [ ] Após a Etapa 3 passar, remova os arquivos antigos `services/routine/blingApi.js` e `services/routine/blingAuth.js`.
- [ ] Rode o projeto (`npm run dev`) e garanta que sobe sem erro de import.

---

## 7. Critérios de aceite (como validar)

1. **Build/boot:** o servidor sobe sem erro de módulo não encontrado.
2. **OAuth JWT:** ao rodar o fluxo OAuth (`GET /auth/bling` → callback), o `access_token` salvo em `bling_tokens` é um JWT (string longa com dois pontos `.` separando 3 partes) — e a coluna não trunca.
3. **Refresh:** forçar a renovação (ou esperar o vencimento) mantém o token no formato JWT (header `enable-jwt: 1` presente no refresh).
4. **Resolução por CPF:** `resolveContatoByCpf('<cpf de teste>')` retorna o contato cujo `numeroDocumento` (só dígitos) bate exatamente; CPF inexistente retorna `null`.
5. **Histórico:** `listPedidosByCpf('<cpf de teste>')` retorna os pedidos do contato, paginando além de 100 itens quando houver.
6. **Sem regressões:** chamadas existentes (`fetchPedidoById`, `fetchContatoById`) continuam funcionando.
7. **Segurança:** nenhum token aparece nos logs.

> Os arquivos `.http` em `/tests` servem de base para testes manuais. Adapte-os para os endpoints da v2 se for validar via HTTP.

---

## 8. O que NÃO fazer (guardrails)

- ❌ Não use nem reintroduza **tokens opacos** (sem `enable-jwt: 1`).
- ❌ Não armazene o JWT em coluna `VARCHAR` curta — sempre `TEXT`.
- ❌ Não **persista** o `client_id`/id de contato do Bling no banco (a v2 é por CPF).
- ❌ Não recrie a **tabela `vendas`** nem a função `fetchPedidosVendas`.
- ❌ Não introduza dependências novas sem necessidade (a auth JWT aqui não exige lib de JWT — o `expires_in` da resposta já basta para controlar validade).
- ❌ Não amplie o escopo para webhook/lotes/resgate — isso é outro workstream.

---

## 9. Dúvidas para escalar ao humano (não chute)

1. **Host do endpoint de token:** manter `https://www.bling.com.br/Api/v3/oauth/token` (atual) ou migrar para `https://api.bling.com.br/...`? Default mantém o atual; confirmar se o app exige o novo host.
2. **Validade do token:** seguir com o controle por `expires_at` (a partir de `expires_in`) ou passar a decodificar o `exp` do JWT? Recomendação: manter `expires_at` (mais simples, sem dependência).
3. **Escopo do app no Bling:** confirmar que contempla leitura de contatos e pedidos antes de validar o histórico.
4. **Cache do histórico:** como o histórico passa a depender do Bling em tempo real, definir se haverá cache curto (ex.: 60s) e timeout — pode ficar para o workstream de domínio, mas registrar a decisão.