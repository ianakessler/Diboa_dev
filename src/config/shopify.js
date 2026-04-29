/**
 * Configuração centralizada para integração com Shopify.
 *
 * Variáveis de ambiente necessárias no .env:
 *   SHOPIFY_CLIENT_ID        – Client ID do app (Dev Dashboard)
 *   SHOPIFY_CLIENT_SECRET    – Client Secret do app (Dev Dashboard)
 *   SHOPIFY_SCOPES           – Ex: "write_discounts,read_orders"
 *   SHOPIFY_REDIRECT_URI     – Ex: "https://sua-api.com/api/v1/auth/shopify/callback"
 *   SHOPIFY_API_VERSION      – Ex: "2026-04"
 */

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'write_discounts,read_discounts,read_orders';
const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET || !SHOPIFY_REDIRECT_URI) {
  throw new Error(
    'Variáveis de ambiente obrigatórias ausentes: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_REDIRECT_URI'
  );
}

/**
 * Valida que o hostname da loja segue o padrão do Shopify.
 * Aceita: nome-da-loja.myshopify.com
 * Rejeita: tudo que não bata com o regex (proteção contra SSRF).
 */
export function isValidShopDomain(shop) {
  if (typeof shop !== 'string') return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

/**
 * Retorna a URL base de admin da loja.
 */
export function adminUrl(shop) {
  return `https://${shop}/admin`;
}

/**
 * Retorna a URL base do GraphQL Admin API.
 */
export function graphqlUrl(shop) {
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}

export {
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  SHOPIFY_SCOPES,
  SHOPIFY_REDIRECT_URI,
  SHOPIFY_API_VERSION,
};
