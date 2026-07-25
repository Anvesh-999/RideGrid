import * as passengerService from './passenger.service.js';
import logger from '../../utils/logger.js';

/**
 * Get current passenger profile
 */
export const getMe = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    logger.info(`[Passenger] Fetching profile for user ID: ${userId}`, { requestId: req.id });

    const profile = await passengerService.getProfileByUserId(userId);

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update current passenger profile
 */
export const updateMe = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    logger.info(`[Passenger] Updating profile for user ID: ${userId}`, { requestId: req.id });

    const profile = await passengerService.updateProfileByUserId(userId, req.body);

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
};
