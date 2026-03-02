import { executarRotina } from '../services/routine/syncRoutine.js';

export async function syncClients(req, res, next) {
  try {
    const resultado = await executarRotina();
    return res.status(200).json({ message: 'Sincronização concluída', resultado });
  } catch (error) {
    next(error);
  }
}
