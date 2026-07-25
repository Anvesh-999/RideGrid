import { Router } from 'express';
import * as authController from './auth.controller.js';
import { registerValidator } from './auth.validator.js';

const router = Router();

// Registration endpoint with input validation middleware
router.post('/register', registerValidator, authController.register);

export default router;
