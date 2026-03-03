import { Router } from 'express';
import { editClient, getAllClients, getClientByCpf } from '../controllers/clienteController.js';
import { syncClients } from '../controllers/syncController.js';

const router = Router();

router.get('/clients', getAllClients);
router.get('/clients/cpf/:cpf', getClientByCpf);
router.post('/sync', syncClients); // Changed from GET to POST — triggers a mutation
router.post('/editClient', editClient);

export default router;
