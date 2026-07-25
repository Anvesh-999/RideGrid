import Ride from './ride.model.js';
import * as fareService from '../fares/fare.service.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';

// State machine allowed transitions
const ALLOWED_TRANSITIONS = {
  REQUESTED: ['SEARCHING', 'CANCELLED'],
  SEARCHING: ['DRIVER_OFFERED', 'NO_DRIVER_FOUND', 'CANCELLED'],
  DRIVER_OFFERED: ['DRIVER_ASSIGNED', 'SEARCHING', 'CANCELLED'],
  DRIVER_ASSIGNED: ['DRIVER_ARRIVING', 'CANCELLED'],
  DRIVER_ARRIVING: ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_DRIVER_FOUND: []
};

/**
 * Create a new ride request
 */
export const createRide = async (passengerId, details) => {
  const { pickup, destination, vehicleType } = details;

  if (!pickup || !destination || !vehicleType) {
    throw new BadRequestError('Pickup, destination, and vehicle type are required.');
  }

  // Calculate fare and estimation parameters
  const estimation = fareService.estimateRideDetails(pickup, destination, vehicleType);

  const ride = new Ride({
    passengerId,
    pickup,
    destination,
    vehicleType,
    status: 'REQUESTED',
    fare: estimation.fare,
    distance: estimation.distance,
    duration: estimation.duration
  });

  await ride.save();
  return ride;
};

/**
 * Fetch a ride by ID, populating passenger and driver details
 */
export const getRideById = async (rideId) => {
  const ride = await Ride.findById(rideId)
    .populate('passengerId', 'name email')
    .populate('driverId', 'name email');

  if (!ride) {
    throw new NotFoundError('Ride not found');
  }

  return ride;
};

/**
 * Transition a ride to a target status with validation and timestamp recording
 */
export const transitionRideStatus = async (rideId, targetStatus, metadata = {}) => {
  const ride = await Ride.findById(rideId);

  if (!ride) {
    throw new NotFoundError('Ride not found');
  }

  const currentStatus = ride.status;

  // Validate transition
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new BadRequestError(
      `Invalid ride status transition from ${currentStatus} to ${targetStatus}.`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  ride.status = targetStatus;

  // Apply lifecycle timestamps & metadata updates
  switch (targetStatus) {
    case 'DRIVER_ASSIGNED':
      if (!metadata.driverId) {
        throw new BadRequestError('driverId is required when assigning a driver.');
      }
      ride.driverId = metadata.driverId;
      ride.assignedAt = new Date();
      break;
    case 'DRIVER_ARRIVED':
      ride.arrivedAt = new Date();
      break;
    case 'IN_PROGRESS':
      ride.startedAt = new Date();
      break;
    case 'COMPLETED':
      ride.completedAt = new Date();
      break;
    case 'CANCELLED':
      if (!metadata.actor) {
        throw new BadRequestError('actor is required when cancelling a ride.');
      }
      ride.cancellation = {
        actor: metadata.actor,
        reason: metadata.reason || '',
        timestamp: new Date()
      };
      break;
  }

  await ride.save();

  // Return populated details
  return getRideById(rideId);
};

/**
 * Cancel a ride
 */
export const cancelRide = async (rideId, actor, reason) => {
  return transitionRideStatus(rideId, 'CANCELLED', { actor, reason });
};
