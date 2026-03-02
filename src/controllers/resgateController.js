import * as resgateService from '../services/resgateService.js';

export async function resgate(req, res, next) {
  try {
    const { cpf, pontos } = req.body;
    await resgateService.resgatar(cpf, pontos);
    return res.status(200).json({ message: 'Resgate efetuado com sucesso' });
  } catch (error) {
    next(error);
  }
}
