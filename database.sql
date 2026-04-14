-- ============================================================================
-- Diboa Cashback — Schema MySQL
-- ============================================================================

CREATE DATABASE IF NOT EXISTS diboa
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE diboa;

-- ── Clientes ────────────────────────────────────────────────────────────────

CREATE TABLE clientes (
  id               INT            AUTO_INCREMENT PRIMARY KEY,
  nome             VARCHAR(255)   NOT NULL,
  numero_documento VARCHAR(14)    NOT NULL,
  client_id        BIGINT         DEFAULT NULL COMMENT 'ID do contato no Bling',
  pontos           DECIMAL(10,2)  NOT NULL DEFAULT 0,
  created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_numero_documento (numero_documento)
) ENGINE=InnoDB;

-- ── Vendas ──────────────────────────────────────────────────────────────────

CREATE TABLE vendas (
  id              INT            AUTO_INCREMENT PRIMARY KEY,
  bling_pedido_id BIGINT         NOT NULL COMMENT 'ID do pedido no Bling',
  numero_pedido   VARCHAR(50)    DEFAULT NULL,
  data_venda      DATE           DEFAULT NULL,
  valor_total     DECIMAL(10,2)  NOT NULL DEFAULT 0,
  cliente_id      BIGINT         DEFAULT NULL COMMENT 'client_id do contato no Bling',
  processada      TINYINT(1)     NOT NULL DEFAULT 0 COMMENT '0=pendente, 1=pontos creditados',
  created_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_bling_pedido_id (bling_pedido_id),
  INDEX idx_cliente_id (cliente_id),
  INDEX idx_processada (processada)
) ENGINE=InnoDB;

-- ── Historico de Resgates ───────────────────────────────────────────────────

CREATE TABLE historico_resgates (
  id                INT            AUTO_INCREMENT PRIMARY KEY,
  cliente_id        BIGINT         NOT NULL,
  pontos_resgatados INT            NOT NULL,
  data_resgate      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_cliente_id (cliente_id)
) ENGINE=InnoDB;

-- ── Bling OAuth Tokens (singleton: sempre id=1) ────────────────────────────

CREATE TABLE bling_tokens (
  id             INT        NOT NULL DEFAULT 1 PRIMARY KEY,
  access_token   TEXT       NOT NULL,
  refresh_token  TEXT       NOT NULL,
  expires_at     BIGINT     NOT NULL COMMENT 'timestamp em ms (Date.now())',
  updated_at     TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
