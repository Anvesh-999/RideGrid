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

/**
 * Transition ride status
 */
export const transitionStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, driverId } = req.body;
    
    logger.info(`[Ride] Status transition requested for ride ID: ${id} to state: ${status}`, { requestId: req.id });

    const metadata = {};
    if (driverId) {
      metadata.driverId = driverId;
    } else if (req.user.role === 'DRIVER') {
      metadata.driverId = req.user.userId;
    }

    const ride = await rideService.transitionRideStatus(id, status, metadata);

    logger.info(`[Ride] Ride ID: ${id} successfully transitioned to: ${status}`, { requestId: req.id });

    // Publish WebSocket notification
    try {
      const { getIo } = await import('../../sockets/index.js');
      const io = getIo();
      const pId = ride.passengerId._id || ride.passengerId;
      io.to(`user:${pId}`).emit('ride:status_changed', ride);
      if (ride.driverId) {
        const dId = ride.driverId._id || ride.driverId;
        io.to(`user:${dId}`).emit('ride:status_changed', ride);
      }
    } catch (socketErr) {
      logger.warn(`[Ride] Socket notification failed for transition: ${socketErr.message}`);
    }

    res.status(200).json({
      success: true,
      data: ride
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve a list of rides based on queries
 */
export const getRides = async (req, res, next) => {
  try {
    const { status, passengerId, driverId } = req.query;
    logger.info('[Ride] Querying ride list request received', { requestId: req.id });

    const filters = {};
    if (status) filters.status = status;
    
    if (req.user.role === 'PASSENGER') {
      filters.passengerId = req.user.userId;
    } else {
      if (passengerId) filters.passengerId = passengerId;
      if (driverId) filters.driverId = driverId;
    }

    const rides = await rideService.queryRides(filters);

    res.status(200).json({
      success: true,
      data: rides
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Handle driver accepting a ride offer
 */
export const acceptOffer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const driverId = req.user.userId;

    logger.info(`[Ride] Driver ${driverId} accepting offer for ride ${id}`, { requestId: req.id });

    const { handleDriverAccept } = await import('../dispatch/dispatch.service.js');
    await handleDriverAccept(id, driverId);

    logger.info(`[Ride] Ride ID: ${id} successfully accepted by driver ${driverId}`, { requestId: req.id });

    // Fetch and return updated ride
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
 * Handle driver rejecting a ride offer
 */
export const rejectOffer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const driverId = req.user.userId;

    logger.info(`[Ride] Driver ${driverId} rejecting offer for ride ${id}`, { requestId: req.id });

    const { handleDriverReject } = await import('../dispatch/dispatch.service.js');
    await handleDriverReject(id, driverId);

    logger.info(`[Ride] Ride ID: ${id} successfully rejected by driver ${driverId}`, { requestId: req.id });

    // Fetch and return updated ride
    const ride = await rideService.getRideById(id);

    res.status(200).json({
      success: true,
      data: ride
    });
  } catch (error) {
    next(error);
  }
};
