import { Router } from 'express';
import { deleteClient, editClient, getAllClients, getClientByCpf } from '../controllers/clienteController.js';
import { syncClients } from '../controllers/syncController.js';

const router = Router();

router.get('/clients', getAllClients);
router.get('/clients/cpf/:cpf', getClientByCpf);
router.post('/sync', syncClients);
router.post('/editClient', editClient);
router.delete('/deleteClient', deleteClient);

export default router;
