import pool from '../config/db.js';

export async function insertCupom(conn, {
  clienteId,
  cpf,
  pontosResgatados,
  valorDesconto,
  codigoCupom,
  shopifyDiscountId,
  expiraEm,
}) {
  const [result] = await conn.query(
    `INSERT INTO cupons_resgate
       (cliente_id, cpf, pontos_resgatados, valor_desconto, codigo_cupom, shopify_discount_id, expira_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [clienteId, cpf, pontosResgatados, valorDesconto, codigoCupom, shopifyDiscountId, expiraEm]
  );
  return result.insertId;
}

export async function findByCodigo(codigo) {
  const [rows] = await pool.query(
    `SELECT id, cliente_id, cpf, pontos_resgatados, valor_desconto, codigo_cupom,
            shopify_discount_id, status, criado_em, utilizado_em, expira_em
     FROM cupons_resgate
     WHERE codigo_cupom = ? AND status = 'criado'
     LIMIT 1`,
    [codigo]
  );
  return rows[0] ?? null;
}

export async function marcarComoUtilizado(conn, codigo) {
  const [result] = await conn.query(
    `UPDATE cupons_resgate
       SET status = 'utilizado', utilizado_em = NOW()
     WHERE codigo_cupom = ? AND status = 'criado'`,
    [codigo]
  );
  return result.affectedRows;
}

export async function findExpirados() {
  const [rows] = await pool.query(
    `SELECT id, cliente_id, codigo_cupom, shopify_discount_id, expira_em
     FROM cupons_resgate
     WHERE status = 'criado' AND expira_em < NOW()`
  );
  return rows;
}

export async function marcarComoExpirado(conn, id) {
  await conn.query(
    `UPDATE cupons_resgate SET status = 'expirado' WHERE id = ?`,
    [id]
  );
}

export async function findAtivosByClienteId(clienteId) {
  const [rows] = await pool.query(
    `SELECT id, codigo_cupom, valor_desconto, pontos_resgatados, criado_em, expira_em
     FROM cupons_resgate
     WHERE cliente_id = ? AND status = 'criado'
     ORDER BY criado_em DESC`,
    [clienteId]
  );
  return rows;
}
