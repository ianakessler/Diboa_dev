import { Router } from 'express';
import { deleteClient, editClient, getAllClients, getAllVendas, getClientByCpf, getHistoricoResgates } from '../controllers/clienteController.js';
import { syncClients } from '../controllers/syncController.js';

const  router = Router();

router.get('/clients', getAllClients);
router.get('/clients/cpf/:cpf', getClientByCpf);
router.get('/historico/resgates/:cpf', getHistoricoResgates);
router.get('/historico/compras/:cpf',getAllVendas);
router.post('/sync', syncClients);
router.patch('/clients/:cpf', editClient);
router.delete('/clients/:cpf', deleteClient);

export default router;
