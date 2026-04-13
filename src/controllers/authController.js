import { getAuthorizationUrl, exchangeCodeForTokens } from '../services/routine/blingAuth.js';

export async function authBling(req, res) {
  const redirectUri = process.env.BLING_REDIRECT_URI;
  const url = getAuthorizationUrl(redirectUri);
  res.redirect(url);
}

export async function authBlingCallback(req, res, next) {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Parametro "code" ausente' });
    const redirectUri = process.env.BLING_REDIRECT_URI;
    await exchangeCodeForTokens(code, redirectUri);
    res.status(200).json({ message: 'Tokens salvos com sucesso' });
  } catch (error) {
    next(error);
  }
}
