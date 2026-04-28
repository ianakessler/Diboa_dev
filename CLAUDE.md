# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Diboa Cashback is a Node.js/Express REST API for a loyalty points program. Customers earn 1 point per R$1.00 from confirmed sales in the Bling ERP. Points can be redeemed by store operators. Written in ESM (import/export) throughout.

## Commands

- `npm run dev` — Start dev server with nodemon (auto-reload on `src/**/*.{js,json}`)
- `npm start` — Start production server (`node src/app.js`)
- `npm test` — Run tests (Node.js native test runner)

## Tech Stack

Node.js ESM, Express 5, MySQL 8 (mysql2/promise connection pool), Bling API v3 (OAuth 2.0), node-cron, helmet, cors, express-rate-limit.

## Architecture

Layered architecture: **Controller → Service → Repository**

- **Controllers** (`src/controllers/`) — Thin HTTP handlers, delegate to services, pass errors via `next(error)`
- **Services** (`src/services/`) — Business logic, validation, transaction management
- **Repository** (`src/repository/`) — Pure SQL queries with parameterized statements (no ORM)
- **Routes** (`src/routes/`) — Express route definitions, mounted under `/api/v1`

### Key Patterns

- **Transactions with row locking**: Critical operations (point redemption) use `conn.beginTransaction()` + `FOR UPDATE` to prevent race conditions. Always follow: `try { commit } catch { rollback } finally { release }`.
- **Idempotency**: Sales use `INSERT IGNORE` with a unique constraint on `bling_pedido_id` — the same sale never credits points twice. Client upsert also uses `INSERT IGNORE` on `numero_documento`.
- **Error hierarchy**: `AppError` (base, in `src/errors/AppError.js`) → `NotFoundError` (404), `BadRequestError` (400), `InsufficientBalanceError` (422). Global error handler middleware is last in the middleware chain.
- **Async errors**: Controllers wrap service calls in try/catch and pass to `next(error)`.

### Bling Integration

- **OAuth tokens** stored as a singleton row (id=1) in `bling_tokens` table
- **Token auto-refresh**: `getValidAccessToken()` in `src/services/routine/blingAuth.js` checks expiry with 5-min safety margin and refreshes automatically
- **Webhook**: `POST /api/v1/webhooks/bling/vendas` — verified via HMAC-SHA256 signature (`src/middleware/blingSignature.js`)
- **Daily sync**: Cron job at 23:55 fetches today's orders as a fallback (`src/services/routine/syncRoutine.js`)

## Database

Schema in `database.sql`. Four tables:
- `clientes` — Customer records with `pontos` balance, unique on `numero_documento` (CPF)
- `vendas` — Sales records, unique on `bling_pedido_id`, `processada` flag tracks point crediting
- `historico_resgates` — Point redemption history log
- `bling_tokens` — OAuth token storage (singleton row)

Foreign keys are logical (via `client_id` column matching Bling contact ID), not DB-enforced constraints.

## Environment

Copy `.env.example` to `.env`. Key variables: `PORT`, `DB_HOST/USER/PASSWORD/NAME`, `DB_CONNECTION_LIMIT`, `CLIENT_ID`, `CLIENT_SECRET`, `BLING_REDIRECT_URI`, `CORS_ORIGIN`.

## API Routes (all under `/api/v1`)

- `GET /health` — Health check
- `GET /clients`, `GET /clients/cpf/:cpf`, `PATCH /clients/:cpf`, `DELETE /clients/:cpf` — Client CRUD
- `POST /resgates` — Redeem points (`{ cpf, pontos }`)
- `GET /historico/resgates/:cpf`, `GET /historico/compras/:cpf` — History
- `GET /auth/bling`, `GET /auth/bling/callback` — Bling OAuth flow
- `POST /webhooks/bling/vendas` — Bling sale webhook (rate-limited: 60 req/min)
- `POST /sync` — Manual sync trigger
