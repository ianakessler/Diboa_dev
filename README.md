# Diboa Cashback — Revisão Técnica & Documentação

---

## 📋 Análise Técnica (Revisão Sênior)

### 1. Arquitetura do Projeto

#### Estado Original — Nível: Júnior/Pleno

O projeto original tinha camadas parcialmente separadas (controllers, services, repository), o que é positivo. No entanto, apresentava problemas sérios:

- `src/models/` e `src/repository/` coexistiam com **funções duplicadas** para as mesmas entidades. Isso quebra o princípio DRY e cria confusão sobre qual camada usar.
- `src/middleware/routrer.js` (erro de digitação) funcionava como roteador central com acoplamento desnecessário.
- Nenhuma padronização de erros — cada camada tratava erros de forma diferente.

#### Estado Refatorado — Nível: Sênior

```
src/
├── config/
│   ├── db.js              # Pool MySQL com validação de env vars
│   └── logger.js          # Logger estruturado centralizado
├── controllers/           # Apenas coordenam req/res → delegam ao service
│   ├── clienteController.js
│   ├── resgateController.js
│   └── syncController.js
├── services/              # Regras de negócio — sem acesso direto ao HTTP
│   ├── clienteService.js
│   ├── resgateService.js
│   └── routine/
│       ├── blingApi.js    # Integração com API externa isolada
│       └── syncRoutine.js # Orquestrador da rotina
├── repository/            # Única camada que fala com o banco
│   ├── clienteRepository.js
│   └── vendaRepository.js
├── routes/
│   ├── clienteRoutes.js
│   └── resgateRoutes.js
├── middleware/
│   └── errorHandler.js    # Handler global de erros
├── errors/
│   └── AppError.js        # Hierarquia de erros tipados
├── validators/
│   └── index.js           # Validação e sanitização de inputs
└── app.js
```

---

### 2. Problemas Críticos Encontrados no Original

**🔴 Críticos**

**1. Token de API hardcoded no código-fonte**
```js
// get_pedidos_bling.js — LINHA 4
const TOKEN = "f0240f6edf5a1190947213a8f0c624d0b5060d1c";
```
Token exposto no repositório. Qualquer pessoa com acesso ao código tem acesso à conta Bling. **Vulnerabilidade de segurança grave — revogar este token imediatamente.**

**2. Variável `formated_data` referenciada mas nunca declarada**
```js
console.log("Pedidos encontrados:", JSON.stringify(formated_data, null, 2));
```
Causa `ReferenceError` em runtime, quebrando a rotina silenciosamente.

**3. PORT hardcoded que ignora o `.env`**
```js
const PORT = 9999 || process.env.PORT; // process.env.PORT NUNCA é avaliado
```

**4. Credenciais de banco hardcoded**
```js
user: 'root', password: 'root'
```

**🟡 Sérios**

**5. Erros suprimidos com `return null`** — Os repositórios capturavam exceções e retornavam `null`, escondendo stack traces e impedindo rollback correto em transações.

**6. Códigos mágicos no service de resgate**
```js
return (-1); // não encontrado
return (-2); // saldo insuficiente
return (0);  // sucesso
```
Anti-padrão. Erros tipados são mais legíveis, seguros e permitem que o Express trate automaticamente.

**7. Acesso antes de checar bounds**
```js
console.log('Pontos: ', clientes[0].pontos); // TypeError se array vazio!
if (clientes.length == 0) { ... }             // checagem DEPOIS do acesso
```

**8. `GET /updateClients` que executa escrita** — Viola o protocolo HTTP. GET deve ser idempotente e sem side-effects.

**🟢 Pontos Positivos (já no nível certo)**

- Uso correto de `getConnection()` + `beginTransaction()` + `commit()/rollback()` + `release()` em `finally`
- Validação de CPF com a biblioteca adequada antes de inserir
- `INSERT IGNORE` para idempotência
- UPDATE JOIN com GROUP BY para processar pontos em batch
- `FOR UPDATE` no resgate para evitar race condition

---

### 3. Banco de Dados

**Índices recomendados:**
```sql
CREATE INDEX idx_clientes_cpf ON clientes(cpf);
CREATE INDEX idx_vendas_processada ON vendas(processada);
CREATE INDEX idx_vendas_cliente_id ON vendas(cliente_id);
CREATE UNIQUE INDEX idx_vendas_bling_id ON vendas(bling_pedido_id);
```

O `UNIQUE` em `bling_pedido_id` é essencial para que o `INSERT IGNORE` funcione corretamente como garantia de idempotência.

---

### 4. O que foi corrigido na refatoração

| Item | Original | Refatorado |
|---|---|---|
| Segredos | ❌ Hardcoded | ✅ `.env` + validação na inicialização |
| Tratamento de erros | ❌ return null / códigos mágicos | ✅ AppError tipado + errorHandler global |
| Nomenclatura | ⚠️ Misto PT/EN, inconsistente | ✅ camelCase consistente |
| Rotas HTTP | ❌ GET para mutação | ✅ POST para operações com side-effects |
| Arquivos duplicados | ❌ models/ e repository/ com funções iguais | ✅ Única fonte de verdade |
| Logs | ⚠️ console.log espalhado | ✅ Logger centralizado e estruturado |
| Documentação | ❌ Ausente | ✅ JSDoc nas funções públicas |
| Variável não declarada | ❌ formated_data (ReferenceError) | ✅ Removido |
| Token exposto | ❌ Hardcoded | ✅ process.env.BLING_TOKEN |

---

### 5. Próximos passos para continuar evoluindo

1. **Testes automatizados** — `node:test` nativo (Node 18+) para testar services com mocks do pool.
2. **Rate limiting** — `express-rate-limit` nos endpoints públicos.
3. **Helmet** — Headers de segurança HTTP.
4. **Agendamento** — `node-cron` para executar `syncRoutine` periodicamente sem chamada HTTP manual.
5. **Schema de validação** — `zod` para validação declarativa de inputs.
6. **Migrations** — `db-migrate` ou similar para versionar o schema.

---

## 🚀 Como rodar

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais reais

# 3. Desenvolvimento
npm run dev

# 4. Produção
npm start
```

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/clients` | Lista todos os clientes |
| `GET` | `/api/v1/clients/cpf/:cpf` | Busca cliente por CPF |
| `POST` | `/api/v1/sync` | Sincroniza pedidos do Bling |
| `POST` | `/api/v1/resgates` | Efetua resgate de pontos |

### Body — POST `/api/v1/resgates`
```json
{
  "cpf": "123.456.789-09",
  "pontos": 100
}
```

### Respostas de erro padronizadas
```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Saldo insuficiente. Disponível: 50, solicitado: 100"
  }
}
```
