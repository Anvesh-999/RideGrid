import PassengerProfile from './passengerProfile.model.js';
import { NotFoundError } from '../../utils/errors.js';

/**
 * Fetch a passenger's profile by userId, initializing one if it doesn't exist.
 */
export const getProfileByUserId = async (userId) => {
  let profile = await PassengerProfile.findOne({ userId }).populate('userId', 'name email role');
  
  if (!profile) {
    // Lazily initialize profile if not already created during registration
    profile = new PassengerProfile({ userId });
    await profile.save();
    profile = await PassengerProfile.findOne({ userId }).populate('userId', 'name email role');
  }
  
  return profile;
};

/**
 * Update a passenger's profile
 */
export const updateProfileByUserId = async (userId, updateData) => {
  const profile = await PassengerProfile.findOne({ userId });
  
  if (!profile) {
    throw new NotFoundError('Passenger profile not found');
  }

  // Update phoneNumber if provided
  if (updateData.phoneNumber !== undefined) {
    profile.phoneNumber = updateData.phoneNumber;
  }

  // Update savedLocations if provided
  if (updateData.savedLocations !== undefined) {
    profile.savedLocations = updateData.savedLocations;
  }

  await profile.save();
  
  // Re-fetch with populated user details
  return PassengerProfile.findOne({ userId }).populate('userId', 'name email role');
};
