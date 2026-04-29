import * as fidelidadeService from '../services/fidelidadeService.js';

export async function consultarSaldo(req, res, next) {
  try {
    const resultado = await fidelidadeService.consultarSaldo(req.params.cpf);
    return res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}

export async function resgatarPontos(req, res, next) {
  try {
    const { cpf, pontos } = req.body;
    const resultado = await fidelidadeService.resgatarPontos(cpf, pontos);
    return res.status(201).json(resultado);
  } catch (error) {
    next(error);
  }
}
