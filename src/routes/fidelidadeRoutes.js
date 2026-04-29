import { Router } from 'express';
import { consultarSaldo, resgatarPontos } from '../controllers/fidelidadeController.js';

const router = Router();

router.get('/fidelidade/:cpf', consultarSaldo);
router.post('/fidelidade/resgate', resgatarPontos);

export default router;
