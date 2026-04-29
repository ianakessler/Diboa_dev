-- =============================================================================
-- Migration: Tabela de tokens Shopify
-- Executar no banco de dados antes de iniciar o fluxo OAuth
-- =============================================================================

CREATE TABLE IF NOT EXISTS shopify_tokens (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  shop         VARCHAR(255) UNIQUE NOT NULL COMMENT 'Ex: diboatabacaria.myshopify.com',
  access_token VARCHAR(500) NOT NULL COMMENT 'Token offline (shpat_xxx)',
  scope        TEXT COMMENT 'Escopos concedidos: write_discounts,read_orders,...',
  installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shop (shop)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
