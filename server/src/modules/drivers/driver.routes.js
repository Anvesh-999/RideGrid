import { Router } from 'express';
import * as driverController from './driver.controller.js';
import * as vehicleController from '../vehicles/vehicle.controller.js';
import { authenticate, authorize } from '../auth/auth.middleware.js';

const router = Router();

// Apply auth and driver RBAC globally to all driver routes
router.use(authenticate);
router.use(authorize('DRIVER'));

router.get('/me', driverController.getMe);
router.patch('/me', driverController.updateMe);
router.post('/status', driverController.updateStatus);

// Vehicle management
router.post('/me/vehicle', vehicleController.registerVehicle);
router.get('/me/vehicle', vehicleController.getVehicle);

export default router;
