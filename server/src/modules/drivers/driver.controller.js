import * as driverService from './driver.service.js';
import logger from '../../utils/logger.js';

/**
 * Fetch current driver's profile
 */
export const getMe = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    logger.info(`[Driver] Fetching profile for user ID: ${userId}`, { requestId: req.id });

    const profile = await driverService.getProfileByUserId(userId);

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update current driver's profile
 */
export const updateMe = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    logger.info(`[Driver] Updating profile for user ID: ${userId}`, { requestId: req.id });

    const profile = await driverService.updateProfileByUserId(userId, req.body);

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update current driver's online/availability status
 */
export const updateStatus = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    logger.info(`[Driver] Status update requested for user ID: ${userId}`, { requestId: req.id });

    const profile = await driverService.updateStatusByUserId(userId, req.body);

    logger.info(`[Driver] Status updated. Online: ${profile.onlineStatus}, Availability: ${profile.availabilityStatus}`, { requestId: req.id });

    res.status(200).json({
      success: true,
      data: profile
    });
  } catch (error) {
    next(error);
  }
};
