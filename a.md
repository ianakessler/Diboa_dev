# Instruções para Claude Code — Middleware de Webhook Bling

## Contexto do Projeto

Este é um sistema Node.js/Express (ESM, `"type": "module"`) de cashback por pontos chamado **Diboa**. Ele recebe webhooks do Bling (ERP) quando vendas são criadas/atualizadas, processa o CPF do cliente e credita pontos. O `CLIENT_SECRET` do Bling já existe em `process.env.CLIENT_SECRET` (usado no fluxo OAuth em `src/services/routine/blingAuth.js`).

---

## Problema Principal

O endpoint de webhook (`POST /api/v1/webhooks/bling/vendas`) **não valida a autenticidade** das requisições. Qualquer pessoa que conheça a URL pode enviar payloads falsos e creditar pontos indevidamente. Além disso, o `express.json()` global consome o body antes que se possa calcular o HMAC, tornando a validação impossível.

---

## Tarefas a Executar (em ordem)

### 1. Preservar o Raw Body para cálculo de HMAC

**Arquivo:** `src/app.js`

O `express.json()` é aplicado globalmente na linha ~20. Quando o Express faz o parse do JSON, o buffer original (raw body) é descartado. Para calcular o HMAC, é necessário o body exatamente como chegou (bytes brutos).

**O que fazer:**

Substituir o `app.use(express.json())` genérico por uma versão que salva o raw body, **mas apenas nas rotas de webhook** (para não desperdiçar memória nas demais rotas):

```js
// Substituir esta linha:
app.use(express.json());

// Por esta lógica:
app.use(express.json({
  verify: (req, _res, buf) => {
    // Salva o raw body apenas para rotas de webhook
    if (req.originalUrl?.startsWith('/api/v1/webhooks')) {
      req.rawBody = buf;
    }
  },
}));
```

> **Importante:** a função `verify` do `express.json()` é chamada antes do parse. O parâmetro `buf` é o Buffer com o body bruto. Salvar em `req.rawBody` não interfere no parse normal do JSON.

---

### 2. Criar o Middleware de Validação HMAC

**Criar arquivo:** `src/middleware/blingSignature.js`

Este middleware deve:

1. Ler o header `X-Bling-Signature-256` da requisição.
2. Extrair o hash (removendo o prefixo `sha256=`).
3. Gerar um HMAC-SHA256 usando o `req.rawBody` (Buffer) e o `process.env.CLIENT_SECRET` como chave.
4. Comparar os dois hashes usando `crypto.timingSafeEqual` (previne timing attacks).
5. Se a assinatura for inválida ou ausente, responder `401` e encerrar.
6. Se válida, chamar `next()`.

**Implementação esperada:**

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import logger from '../config/logger.js';

export function verifyBlingSignature(req, res, next) {
  const signatureHeader = req.headers['x-bling-signature-256'];

  if (!signatureHeader) {
    logger.warn('Webhook recebido sem header X-Bling-Signature-256', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({ error: 'Assinatura ausente' });
  }

  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientSecret) {
    logger.error('CLIENT_SECRET não configurado no .env');
    return res.status(500).json({ error: 'Configuração interna ausente' });
  }

  // O header vem no formato "sha256=<hex>"
  const receivedHash = signatureHeader.replace(/^sha256=/, '');

  // Gerar HMAC com o raw body (Buffer) e o client_secret
  const expectedHash = createHmac('sha256', clientSecret)
    .update(req.rawBody)   // req.rawBody é o Buffer salvo no verify do express.json
    .digest('hex');

  // Comparação segura contra timing attacks
  const receivedBuf = Buffer.from(receivedHash, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');

  if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
    logger.warn('Webhook com assinatura HMAC inválida', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({ error: 'Assinatura inválida' });
  }

  next();
}
```

**Notas sobre a implementação:**
- Usar `node:crypto` (built-in, não precisa instalar nada).
- O `timingSafeEqual` exige que os dois Buffers tenham o mesmo tamanho. Se `receivedHash` tiver tamanho diferente do esperado (64 chars hex para SHA-256), a comparação de `.length` já rejeita.
- O encoding deve ser UTF-8 (padrão do Node.js para strings — já atende ao requisito do Bling).

---

### 3. Registrar o Middleware na Rota de Webhook

**Arquivo:** `src/routes/webhookRoutes.js`

Adicionar o import do middleware e aplicá-lo **antes** do controller na rota:

```js
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

// Ordem: rate limit → validar assinatura HMAC → controller
router.post('/webhooks/bling/vendas', webhookLimiter, verifyBlingSignature, handleBlingVendaWebhook);

export default router;
```

---

### 4. Ajustar o Rate Limiter Global para Não Bloquear Webhooks

**Arquivo:** `src/app.js`

O rate limiter global (100 req / 15 min) pode bloquear retentativas legítimas do Bling. Webhooks vêm do servidor do Bling, não de usuários humanos — o rate limit por rota já cuida do controle.

**O que fazer:** Excluir as rotas de webhook do rate limiter global:

```js
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, try again later' },
  skip: (req) => req.path.startsWith('/webhooks/'),
}));
```

> **Nota:** o `req.path` dentro do router montado em `/api/v1` já terá o prefixo removido pelo Express. Testar com `req.originalUrl` se necessário: `req.originalUrl.includes('/webhooks/')`.

Se `skip` com `req.path` não funcionar no contexto do middleware global (que roda antes do mount do router), usar:

```js
skip: (req) => req.originalUrl?.includes('/webhooks/'),
```

---

### 5. Garantir Idempotência e Resposta Rápida (< 5 segundos)

**Arquivo:** `src/controllers/webhookController.js`

O controller atual **já responde 200 imediatamente** antes de processar — isso é correto e atende ao requisito de < 5 segundos. Porém, se o processamento async falhar, apenas loga o erro (correto).

**Verificar que o controller continua assim:**

```js
import { processarWebhookVenda } from '../services/webhookService.js';
import logger from '../config/logger.js';

export async function handleBlingVendaWebhook(req, res) {
  // Responder 200 imediatamente (requisito Bling: < 5s)
  res.status(200).json({ received: true });

  // Processar de forma assíncrona
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

**Nota sobre idempotência:** O `webhookService.js` já usa `INSERT IGNORE` para vendas e clientes, e verifica `processada = 0` antes de creditar pontos. Isso garante que webhooks duplicados não creditam pontos duas vezes. **Não é necessário alterar o service.**

---

### 6. Adicionar `CLIENT_SECRET` ao `.env` (se ainda não existir)

Garantir que o `.env` tem a variável:

```
CLIENT_SECRET=seu_client_secret_do_app_bling
```

Esta variável já é usada pelo `blingAuth.js` para o fluxo OAuth, então provavelmente já existe. O middleware de webhook vai reutilizar a mesma variável.

---

## Resumo dos Arquivos Afetados

| Arquivo | Ação |
|---------|------|
| `src/middleware/blingSignature.js` | **CRIAR** — middleware de validação HMAC |
| `src/app.js` | **EDITAR** — adicionar `verify` ao `express.json()` e skip de webhook no rate limiter global |
| `src/routes/webhookRoutes.js` | **EDITAR** — importar e aplicar `verifyBlingSignature` na rota |
| `src/controllers/webhookController.js` | **VERIFICAR** — já está correto, opcionalmente adicionar `stack` no log de erro |
| `.env` | **VERIFICAR** — `CLIENT_SECRET` já deve existir |

---

## Checklist de Validação

Após implementar, verificar:

- [ ] O middleware rejeita requisições **sem** o header `X-Bling-Signature-256` (retorna 401).
- [ ] O middleware rejeita requisições com assinatura **inválida** (retorna 401).
- [ ] O middleware aceita requisições com assinatura **válida** (retorna 200).
- [ ] O `rawBody` é um Buffer (não string) — necessário para o HMAC ser consistente.
- [ ] O rate limiter global não bloqueia IPs do Bling durante retentativas.
- [ ] A resposta 200 é enviada em < 5 segundos (o processamento é async depois do res.json).
- [ ] Webhooks duplicados não creditam pontos duas vezes (já garantido pelo INSERT IGNORE + flag `processada`).

---

## Script de Teste Manual

Para testar localmente se o middleware funciona, usar este script Node.js:

```js
import { createHmac } from 'node:crypto';

const SECRET = 'seu_client_secret_aqui';
const payload = JSON.stringify({
  dados: {
    id: 123,
    numero: '1001',
    data: '2025-01-15',
    total: 150.00,
    situacao: { valor: 1 },
    contato: {
      id: 456,
      nome: 'Fulano de Tal',
      numeroDocumento: '123.456.789-09',
    },
  },
});

const hash = createHmac('sha256', SECRET).update(payload, 'utf-8').digest('hex');
console.log('Header a enviar:');
console.log(`X-Bling-Signature-256: sha256=${hash}`);
console.log('');
console.log('curl de teste:');
console.log(`curl -X POST http://localhost:9292/api/v1/webhooks/bling/vendas \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -H "X-Bling-Signature-256: sha256=${hash}" \\`);
console.log(`  -d '${payload}'`);
```

---

## Notas Importantes da Documentação Bling

1. **Retentativas por até 3 dias** — se o endpoint retornar != 2xx ou demorar > 5s, o Bling reenvia. Se continuar falhando, **desabilita o webhook** automaticamente. Por isso é crítico responder 200 rápido.
2. **Entrega não ordenada** — um webhook de atualização pode chegar antes do de criação. O `INSERT IGNORE` já lida com isso (se a venda já existir, ignora).
3. **Encoding UTF-8** — o Node.js já usa UTF-8 por padrão para strings, então o HMAC será calculado corretamente.