import * as clienteService from '../services/clienteService.js';

export async function getAllClients(req, res, next) {
  try {
    const clients = await clienteService.getAll();
    return res.status(200).json(clients);
  } catch (error) {
    next(error);
  }
}

export async function getClientByCpf(req, res, next) {
  try {
    const client = await clienteService.getByCpf(req.params.cpf);
    return res.status(200).json(client);
  } catch (error) {
    next(error);
  }
}

export async function editClient(req, res, next) {
  try {
    const {cpf, pontos, nome} = req.body;
    await clienteService.editByCpf(cpf, pontos, nome);
    return res.status(200).json({res: "Cliente atualizado"});
  } catch (error) {
    next(error);
  }
}

export async function deleteClient(req, res, next)
{
  try{
    const cpf = req.params.cpf;
    console.log(`[DEBUG] req.body: cpf == ${cpf}`);
    await clienteService.deleteByCpf(cpf);
    return res.status(200).json({res: "Cliente deletado com sucesso!"});
  } catch (error)
  {
    next(error);
  }

}

export async function getHistoricoResgates(req, res, next){
  try{
    const doc = req.params.cpf;
    const historico = await clienteService.montarHistorico(doc);
    return res.status(200).json(historico);
  } catch (error){
    next(error);
  }
}

export async function getAllVendas(req, res, next) {
  try{
    const doc = req.params.cpf;
    const historico = await clienteService.getHistory(doc);
    return res.status(200).json(historico);
  } catch (error){
    next(error);
  }
}