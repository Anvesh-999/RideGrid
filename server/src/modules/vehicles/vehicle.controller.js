import * as vehicleService from './vehicle.service.js';
import logger from '../../utils/logger.js';

/**
 * Register a vehicle for the logged-in driver
 */
export const registerVehicle = async (req, res, next) => {
  try {
    const driverId = req.user.userId;
    logger.info(`[Vehicle] Attempting vehicle registration for driver ID: ${driverId}`, { requestId: req.id });

    const vehicle = await vehicleService.registerVehicle(driverId, req.body);

    logger.info(`[Vehicle] Vehicle registered successfully (ID: ${vehicle._id}) for driver: ${driverId}`, { requestId: req.id });

    res.status(201).json({
      success: true,
      data: vehicle
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve the logged-in driver's vehicle
 */
export const getVehicle = async (req, res, next) => {
  try {
    const driverId = req.user.userId;
    logger.info(`[Vehicle] Fetching vehicle details for driver ID: ${driverId}`, { requestId: req.id });

    const vehicle = await vehicleService.getVehicleByDriverId(driverId);

    res.status(200).json({
      success: true,
      data: vehicle
    });
  } catch (error) {
    next(error);
  }
};
