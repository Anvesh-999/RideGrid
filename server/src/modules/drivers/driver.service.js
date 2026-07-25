import DriverProfile from './driverProfile.model.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';

/**
 * Fetch a driver's profile by userId, initializing one if it doesn't exist.
 */
export const getProfileByUserId = async (userId) => {
  let profile = await DriverProfile.findOne({ userId })
    .populate('userId', 'name email role')
    .populate('vehicleId');

  if (!profile) {
    // Lazily initialize profile if not already created during registration
    profile = new DriverProfile({ userId });
    await profile.save();
    profile = await DriverProfile.findOne({ userId })
      .populate('userId', 'name email role')
      .populate('vehicleId');
  }

  return profile;
};

/**
 * Update a driver's profile fields
 */
export const updateProfileByUserId = async (userId, updateData) => {
  const profile = await DriverProfile.findOne({ userId });

  if (!profile) {
    throw new NotFoundError('Driver profile not found');
  }

  // Update allowed fields
  if (updateData.vehicleId !== undefined) {
    profile.vehicleId = updateData.vehicleId;
  }

  await profile.save();

  return getProfileByUserId(userId);
};

/**
 * Transition driver availability and online statuses with validation
 */
export const updateStatusByUserId = async (userId, statusData) => {
  const profile = await DriverProfile.findOne({ userId });

  if (!profile) {
    throw new NotFoundError('Driver profile not found');
  }

  const { onlineStatus, availabilityStatus } = statusData;

  // Rule: Cannot go online/available without a registered vehicle
  if ((onlineStatus === 'ONLINE' || availabilityStatus === 'AVAILABLE') && !profile.vehicleId) {
    throw new BadRequestError('Cannot go online without registering a vehicle first.', 'VEHICLE_REQUIRED');
  }

  // Handle onlineStatus update
  if (onlineStatus !== undefined) {
    if (!['ONLINE', 'OFFLINE'].includes(onlineStatus)) {
      throw new BadRequestError(`Invalid online status: ${onlineStatus}`);
    }
    profile.onlineStatus = onlineStatus;
    
    // Auto-align availabilityStatus based on onlineStatus
    if (onlineStatus === 'OFFLINE') {
      profile.availabilityStatus = 'OFFLINE';
    } else if (onlineStatus === 'ONLINE' && profile.availabilityStatus === 'OFFLINE') {
      profile.availabilityStatus = 'AVAILABLE';
    }
  }

  // Handle availabilityStatus transition directly
  if (availabilityStatus !== undefined) {
    if (!['OFFLINE', 'AVAILABLE', 'RESERVED', 'ON_TRIP'].includes(availabilityStatus)) {
      throw new BadRequestError(`Invalid availability status: ${availabilityStatus}`);
    }

    // State machine transitions validation
    const current = profile.availabilityStatus;
    const target = availabilityStatus;

    if (current !== target) {
      // Validate disallowed transitions
      const isTransitionAllowed = validateTransition(current, target);
      if (!isTransitionAllowed) {
        throw new BadRequestError(
          `Invalid availability transition from ${current} to ${target}.`,
          'INVALID_STATUS_TRANSITION'
        );
      }
      profile.availabilityStatus = target;

      // Auto-align onlineStatus
      if (target === 'OFFLINE') {
        profile.onlineStatus = 'OFFLINE';
      } else {
        profile.onlineStatus = 'ONLINE';
      }
    }
  }

  await profile.save();
  return getProfileByUserId(userId);
};

/**
 * Validates availability status transitions
 */
const validateTransition = (current, target) => {
  const allowed = {
    OFFLINE: ['AVAILABLE', 'OFFLINE'],
    AVAILABLE: ['OFFLINE', 'RESERVED', 'AVAILABLE'],
    RESERVED: ['AVAILABLE', 'ON_TRIP', 'OFFLINE'],
    ON_TRIP: ['AVAILABLE', 'OFFLINE']
  };

  return allowed[current]?.includes(target) || false;
};
