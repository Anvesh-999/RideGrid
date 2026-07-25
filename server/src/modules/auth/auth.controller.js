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

/**
 * Handle token refresh requests
 */
export const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    logger.info('[Auth] Token refresh request received', { requestId: req.id });

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REFRESH_TOKEN_REQUIRED',
          message: 'Refresh token is required.'
        }
      });
    }

    const result = await authService.rotateRefreshToken(refreshToken);

    logger.info(`[Auth] Token refresh successful for user ID: ${result.user.id || result.user._id}`, { requestId: req.id });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle user logout requests
 */
export const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    logger.info('[Auth] Logout request received', { requestId: req.id });

    if (refreshToken) {
      await authService.logoutByToken(refreshToken);
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (error) {
    next(error);
  }
};
