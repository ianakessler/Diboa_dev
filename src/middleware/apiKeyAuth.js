export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'API key inválida ou ausente' },
    });
  }
  next();
}
