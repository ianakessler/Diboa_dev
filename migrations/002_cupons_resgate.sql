-- =============================================================================
-- Migration: Tabela de cupons de resgate
-- Armazena cupons de desconto criados no Shopify a partir de resgates de pontos.
-- =============================================================================

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
