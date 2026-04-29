import { randomBytes } from 'node:crypto';
import { graphqlUrl } from '../config/shopify.js';
import { loadToken } from './shopifyAuthService.js';
import logger from '../config/logger.js';
import { AppError } from '../errors/AppError.js';

function gerarCodigoCupom() {
  return `DIBOA-${randomBytes(4).toString('hex').toUpperCase()}`;
}

async function shopifyGraphQL(shop, query, variables) {
  const token = await loadToken(shop);
  if (!token) {
    throw new AppError(
      'Token Shopify não encontrado. Instale o app primeiro.',
      500,
      'SHOPIFY_NOT_INSTALLED'
    );
  }

  const response = await fetch(graphqlUrl(shop), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token.accessToken,
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error('Shopify GraphQL request falhou', {
      shop,
      status: response.status,
      body,
    });
    throw new AppError(
      `Erro Shopify GraphQL: ${response.status}`,
      502,
      'SHOPIFY_GRAPHQL_ERROR'
    );
  }

  const json = await response.json();

  if (json.errors?.length) {
    logger.error('Shopify GraphQL retornou erros', { shop, errors: json.errors });
    throw new AppError(
      `Erro Shopify GraphQL: ${json.errors[0].message}`,
      502,
      'SHOPIFY_GRAPHQL_ERROR'
    );
  }

  return json.data;
}

export async function criarCupomDesconto({ shop, titulo, valorDesconto, diasExpiracao = 30 }) {
  const codigoCupom = gerarCodigoCupom();
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + diasExpiracao * 24 * 60 * 60 * 1000).toISOString();

  const mutation = `
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              codes(first: 1) {
                nodes { code }
              }
              startsAt
              endsAt
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: titulo,
      code: codigoCupom,
      startsAt,
      endsAt,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      customerGets: {
        value: {
          discountAmount: {
            amount: String(valorDesconto),
            appliesOnEachItem: false,
          },
        },
        items: { all: true },
      },
    },
  };

  const data = await shopifyGraphQL(shop, mutation, variables);

  const userErrors = data?.discountCodeBasicCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    logger.error('Shopify discountCodeBasicCreate userErrors', { shop, userErrors });
    throw new AppError(
      `Erro ao criar cupom Shopify: ${userErrors[0].message}`,
      502,
      'SHOPIFY_DISCOUNT_ERROR'
    );
  }

  const shopifyDiscountId = data?.discountCodeBasicCreate?.codeDiscountNode?.id;

  logger.info('Cupom Shopify criado', { shop, codigoCupom, shopifyDiscountId });

  return { codigoCupom, shopifyDiscountId, startsAt, endsAt };
}

export async function deletarCupomShopify(shop, shopifyDiscountId) {
  const mutation = `
    mutation {
      discountCodeDelete(id: "${shopifyDiscountId}") {
        deletedCodeDiscountId
        userErrors { field message }
      }
    }
  `;

  try {
    const data = await shopifyGraphQL(shop, mutation, {});
    const userErrors = data?.discountCodeDelete?.userErrors ?? [];
    if (userErrors.length > 0) {
      logger.warn('Falha ao deletar cupom Shopify (userErrors)', {
        shop,
        shopifyDiscountId,
        userErrors,
      });
    } else {
      logger.info('Cupom Shopify deletado', { shop, shopifyDiscountId });
    }
  } catch (err) {
    logger.warn('Erro ao deletar cupom Shopify (ignorado)', {
      shop,
      shopifyDiscountId,
      error: err.message,
    });
  }
}
