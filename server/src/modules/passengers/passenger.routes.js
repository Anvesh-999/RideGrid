import { Router } from 'express';
import * as passengerController from './passenger.controller.js';
import { authenticate, authorize } from '../auth/auth.middleware.js';

const router = Router();

// Apply auth and passenger RBAC globally to all passenger routes
router.use(authenticate);
router.use(authorize('PASSENGER'));

router.get('/me', passengerController.getMe);
router.patch('/me', passengerController.updateMe);

export default router;
