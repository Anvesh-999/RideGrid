import { Router } from 'express';
import * as rideController from './ride.controller.js';
import { authenticate, authorize } from '../auth/auth.middleware.js';

const router = Router();

// Apply authentication globally to all ride routes
router.use(authenticate);

// Estimation endpoint (accessible to all authenticated users)
router.post('/estimate', rideController.getEstimate);

// Creation endpoint (restricted to PASSENGER role only)
router.post('/', authorize('PASSENGER'), rideController.createRequest);

// Lookup and cancellation endpoints (accessible to all authenticated roles)
router.get('/:id', rideController.getDetails);
router.post('/:id/cancel', rideController.cancel);

export default router;
