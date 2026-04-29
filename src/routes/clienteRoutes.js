import { Router } from 'express';
import { deleteClient, editClient, getAllClients, getAllVendas, getClientByCpf, getHistoricoResgates } from '../controllers/clienteController.js';
import { syncClients } from '../controllers/syncController.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';

const router = Router();

// ── Rotas públicas (usadas pelo frontend/widget) ────────────────────────────
router.get('/clients/cpf/:cpf', getClientByCpf);
router.get('/historico/resgates/:cpf', getHistoricoResgates);
router.get('/historico/compras/:cpf', getAllVendas);

// ── Rotas administrativas (protegidas por API Key) ──────────────────────────
router.get('/clients', requireApiKey, getAllClients);
router.post('/sync', requireApiKey, syncClients);
router.patch('/clients/:cpf', requireApiKey, editClient);
router.delete('/clients/:cpf', requireApiKey, deleteClient);

export default router;
