import * as authService from './auth.service.js';
import logger from '../../utils/logger.js';

/**
 * Handle user registration requests
 */
export const register = async (req, res, next) => {
  try {
    logger.info(`[Auth] Attempting registration for email: ${req.body.email}`, { requestId: req.id });
    
    const result = await authService.register(req.body);
    
    logger.info(`[Auth] Registration successful for user ID: ${result.user.id || result.user._id}`, { requestId: req.id });

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login handler placeholder
 */
export const login = async (req, res, next) => {
  // To be implemented
  res.status(501).json({ success: false, message: 'Not Implemented' });
};
