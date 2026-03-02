import { Router } from 'express';
import { resgate } from '../controllers/resgateController.js';

const router = Router();

router.post('/resgates', resgate);

export default router;
