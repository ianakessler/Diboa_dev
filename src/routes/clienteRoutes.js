import { Router } from 'express';
import { deleteClient, editClient, getAllClients, getClientByCpf } from '../controllers/clienteController.js';
import { syncClients } from '../controllers/syncController.js';

const router = Router();

router.get('/clients', getAllClients);
router.get('/clients/cpf/:cpf', getClientByCpf);
router.get('/historicoResgates/:cpf', )
router.post('/sync', syncClients);
router.post('/editClient', editClient);
router.delete('/deleteClient/:cpf', deleteClient);

export default router;
