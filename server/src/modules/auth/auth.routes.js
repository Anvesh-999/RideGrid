import { Router } from 'express';
import * as authController from './auth.controller.js';
import { registerValidator, loginValidator } from './auth.validator.js';

const router = Router();

// Registration endpoint with input validation middleware
router.post('/register', registerValidator, authController.register);

// Login endpoint with input validation middleware
router.post('/login', loginValidator, authController.login);

// Refresh token endpoint
router.post('/refresh', authController.refresh);

// Logout endpoint
router.post('/logout', authController.logout);

export default router;
