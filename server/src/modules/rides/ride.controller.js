import * as rideService from './ride.service.js';
import * as fareService from '../fares/fare.service.js';
import logger from '../../utils/logger.js';

/**
 * Handle new ride requests
 */
export const createRequest = async (req, res, next) => {
  try {
    const passengerId = req.user.userId;
    logger.info(`[Ride] Request creation initiated by passenger ID: ${passengerId}`, { requestId: req.id });

    const ride = await rideService.createRide(passengerId, req.body);

    logger.info(`[Ride] Ride request created successfully (ID: ${ride._id})`, { requestId: req.id });

    res.status(201).json({
      success: true,
      data: ride
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get fare and distance estimations
 */
export const getEstimate = async (req, res, next) => {
  try {
    const { pickup, destination, vehicleType } = req.body;
    logger.info('[Ride] Fare estimation request received', { requestId: req.id });

    const estimation = fareService.estimateRideDetails(pickup, destination, vehicleType);

    res.status(200).json({
      success: true,
      data: estimation
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve specific ride details
 */
export const getDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    logger.info(`[Ride] Fetching details for ride ID: ${id}`, { requestId: req.id });

    const ride = await rideService.getRideById(id);

    res.status(200).json({
      success: true,
      data: ride
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel an active ride request
 */
export const cancel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const actor = req.user.role; // Determins if CANCELLED by PASSENGER or DRIVER (or ADMIN)
    
    logger.info(`[Ride] Cancel request initiated by ${actor} for ride ID: ${id}`, { requestId: req.id });

    const ride = await rideService.cancelRide(id, actor, reason);

    logger.info(`[Ride] Ride ID: ${id} successfully cancelled by ${actor}`, { requestId: req.id });

    res.status(200).json({
      success: true,
      data: ride
    });
  } catch (error) {
    next(error);
  }
};
