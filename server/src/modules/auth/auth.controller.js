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
 * Handle user login requests
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    logger.info(`[Auth] Login attempt for email: ${email}`, { requestId: req.id });

    const result = await authService.login(email, password);

    logger.info(`[Auth] Login successful for user ID: ${result.user.id || result.user._id}`, { requestId: req.id });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};
