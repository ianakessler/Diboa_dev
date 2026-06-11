-- =============================================================================
-- Migration: bling_tokens — suporte a JWT
-- Bling descontinuou tokens opacos. O JWT tem ~1.500–3.000 chars e NÃO cabe
-- em VARCHAR(500): a coluna precisa ser TEXT, senão o token trunca e a auth
-- quebra com 401 silencioso.
--
-- expires_at guarda epoch em MILISSEGUNDOS (Date.now() + expires_in*1000),
-- por isso BIGINT.
--
-- Use UMA das duas opções abaixo:
--   - Opção A (CREATE): banco novo, tabela ainda não existe.
--   - Opção B (ALTER):  tabela já veio da v1 com access_token VARCHAR(500).
-- =============================================================================

-- ── Opção A: banco novo ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bling_tokens (
  id            INT PRIMARY KEY,
  access_token  TEXT NOT NULL COMMENT 'JWT Bling (~1.5k–3k chars) — precisa ser TEXT',
  refresh_token TEXT NOT NULL COMMENT 'Refresh token — TEXT por segurança',
  expires_at    BIGINT NOT NULL COMMENT 'Epoch em ms (Date.now() + expires_in*1000)',
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Opção B: tabela já existe (v1) — ampliar colunas para caber o JWT ─────────
-- ALTER TABLE bling_tokens MODIFY access_token  TEXT NOT NULL;
-- ALTER TABLE bling_tokens MODIFY refresh_token TEXT NOT NULL;
-- ALTER TABLE bling_tokens MODIFY expires_at    BIGINT NOT NULL;

-- ── Verificação ──────────────────────────────────────────────────────────────
-- SHOW COLUMNS FROM bling_tokens;  -- access_token / refresh_token devem ser TEXT
