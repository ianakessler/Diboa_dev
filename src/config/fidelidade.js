export const CONFIG_FIDELIDADE = {
  PONTOS_POR_REAL: 20,
  OPCOES_RESGATE: [
    { pontos: 200, valor: 10 },
    { pontos: 500, valor: 25 },
    { pontos: 1000, valor: 50 },
    { pontos: 2000, valor: 100 },
  ],
  DIAS_EXPIRACAO: 30,
  SHOP: process.env.SHOPIFY_STORE_DOMAIN || 'diboatabacaria.myshopify.com',
};
