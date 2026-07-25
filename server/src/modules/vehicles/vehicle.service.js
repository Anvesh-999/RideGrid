import Vehicle from './vehicle.model.js';
import DriverProfile from '../drivers/driverProfile.model.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';

/**
 * Register a vehicle for a driver and link it to their DriverProfile
 */
export const registerVehicle = async (driverId, vehicleData) => {
  // Check if driver already has a vehicle
  const existingVehicle = await Vehicle.findOne({ driverId });
  if (existingVehicle) {
    throw new ConflictError('Driver already has a registered vehicle. Use update instead.', 'VEHICLE_ALREADY_REGISTERED');
  }

  // Check if license plate is unique
  const plateConflict = await Vehicle.findOne({ licensePlate: vehicleData.licensePlate.toUpperCase() });
  if (plateConflict) {
    throw new ConflictError('License plate is already in use by another vehicle.', 'LICENSE_PLATE_CONFLICT');
  }

  // Create vehicle record
  const vehicle = new Vehicle({
    driverId,
    make: vehicleData.make,
    model: vehicleData.model,
    licensePlate: vehicleData.licensePlate,
    type: vehicleData.type,
    capacity: vehicleData.capacity
  });

  await vehicle.save();

  // Link to DriverProfile (initialize one if missing)
  let profile = await DriverProfile.findOne({ userId: driverId });
  if (!profile) {
    profile = new DriverProfile({ userId: driverId });
  }
  
  profile.vehicleId = vehicle._id;
  await profile.save();

  return vehicle;
};

/**
 * Fetch vehicle details for a driver
 */
export const getVehicleByDriverId = async (driverId) => {
  const vehicle = await Vehicle.findOne({ driverId });
  
  if (!vehicle) {
    throw new NotFoundError('No vehicle registered for this driver');
  }

  return vehicle;
};
