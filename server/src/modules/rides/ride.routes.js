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

// Lookup, status update and cancellation endpoints (accessible to all authenticated roles)
router.get('/', rideController.getRides);
router.get('/:id', rideController.getDetails);
router.patch('/:id/status', rideController.transitionStatus);
router.post('/:id/cancel', rideController.cancel);

// Driver offer accept/reject endpoints (restricted to DRIVER role)
router.post('/:id/accept', authorize('DRIVER'), rideController.acceptOffer);
router.post('/:id/reject', authorize('DRIVER'), rideController.rejectOffer);

export default router;
