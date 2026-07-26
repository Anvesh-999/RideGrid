import { redisClient } from '../../config/redis.js';
import DriverProfile from '../drivers/driverProfile.model.js';
import { isUserConnected, sendToUser } from '../../sockets/index.js';
import dispatchEvents from './dispatch.events.js';
import logger from '../../utils/logger.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';

// Dynamic import helper to avoid load-time ESModule circular dependencies
const getRideService = async () => {
  return await import('../rides/ride.service.js');
};

/**
 * Initiates the dispatch job loop asynchronously for a ride in SEARCHING status.
 */
export const processRide = async (rideId) => {
  logger.info(`[Dispatch] Initiating automated dispatch loop for ride ID: ${rideId}`);

  try {
    const { getRideById, transitionRideStatus } = await getRideService();
    
    let ride = await getRideById(rideId);
    if (!ride || ride.status !== 'SEARCHING') {
      logger.info(`[Dispatch] Ride ${rideId} is no longer in SEARCHING status (${ride?.status}). Stopping.`);
      return;
    }

    const pickupLng = ride.pickup.longitude;
    const pickupLat = ride.pickup.latitude;

    logger.info(`[Dispatch] Searching available drivers around pickup coordinates: ${pickupLat}, ${pickupLng}`);
    const nearbyDriverIds = await redisClient.geoSearch('drivers:geo', {
      longitude: pickupLng,
      latitude: pickupLat
    }, { radius: 10, unit: 'km' });

    logger.info(`[Dispatch] Redis GEO returned ${nearbyDriverIds.length} candidate driver(s)`);

    // Fetch candidate profiles and validate eligibility
    const candidates = [];
    for (const driverId of nearbyDriverIds) {
      const profile = await DriverProfile.findOne({ userId: driverId })
        .populate('userId')
        .populate('vehicleId');

      if (!profile) continue;

      // Validate online and availability states
      if (profile.onlineStatus !== 'ONLINE' || profile.availabilityStatus !== 'AVAILABLE') {
        continue;
      }
      
      // Validate vehicle class matching
      if (!profile.vehicleId || profile.vehicleId.type !== ride.vehicleType) {
        continue;
      }

      // Check if driver has active Socket.IO connection
      if (!isUserConnected(driverId)) {
        continue;
      }

      // Check if driver is already locked by another dispatch
      const lockKey = `driver:reservation:${driverId}`;
      const isReserved = await redisClient.get(lockKey);
      if (isReserved) {
        continue;
      }

      candidates.push(profile);
    }

    logger.info(`[Dispatch] Eligible driver candidates count: ${candidates.length}`);

    if (candidates.length === 0) {
      logger.warn(`[Dispatch] No eligible drivers found for ride ${rideId}`);
      await transitionRideStatus(rideId, 'NO_DRIVER_FOUND');
      return;
    }

    // Try each candidate in order of distance (Redis geoSearch already sorted them)
    for (const driver of candidates) {
      // Re-fetch ride state to handle concurrent cancellation
      ride = await getRideById(rideId);
      if (ride.status !== 'SEARCHING') {
        logger.info(`[Dispatch] Ride ${rideId} is no longer SEARCHING (Current: ${ride.status}). Stopping dispatch.`);
        return;
      }

      const driverId = driver.userId._id.toString();
      const lockKey = `driver:reservation:${driverId}`;

      // 1. Atomic reservation lock using Redis SET NX with 15s TTL
      const lockAcquired = await redisClient.set(lockKey, rideId.toString(), { NX: true, EX: 15 });
      if (!lockAcquired) {
        logger.warn(`[Dispatch] Failed to acquire lock for driver ${driverId}. Driver is busy. Skipping.`);
        continue;
      }

      logger.info(`[Dispatch] Atomic lock reserved driver ${driverId} for ride ${rideId}`);

      // 2. Transition driver availability database state to RESERVED
      await DriverProfile.updateOne({ userId: driverId }, { availabilityStatus: 'RESERVED' });

      // 3. Transition Ride status to DRIVER_OFFERED with current driver metadata
      await transitionRideStatus(rideId, 'DRIVER_OFFERED', { driverId });

      // 4. Dispatch WebSocket Offer event
      sendToUser(driverId, 'ride:offer', {
        rideId: rideId.toString(),
        pickup: ride.pickup,
        destination: ride.destination,
        fare: ride.fare,
        timeout: 15
      });

      // 5. Wait for offer resolution (Accept / Reject / Expiration)
      const resolutionPromise = new Promise((resolve) => {
        const onResolve = (data) => {
          if (data.driverId.toString() === driverId) {
            resolve(data.status);
          }
        };

        // Listen for resolution signaling
        dispatchEvents.on(`offer_resolved_${rideId}`, onResolve);

        // Configurable timeout fallback (useful for fast unit testing)
        const offerTimeoutMs = Number(process.env.DISPATCH_OFFER_TIMEOUT) || 15000;
        setTimeout(() => {
          dispatchEvents.off(`offer_resolved_${rideId}`, onResolve);
          resolve('timeout');
        }, offerTimeoutMs);
      });

      const outcome = await resolutionPromise;
      logger.info(`[Dispatch] Dispatch outcome for driver ${driverId} on ride ${rideId}: ${outcome}`);

      if (outcome === 'accepted') {
        // Driver accepted. Loop terminates successfully.
        return;
      } else {
        // Release Redis lock
        await redisClient.del(lockKey);

        // Revert driver profile state to AVAILABLE if it is still RESERVED
        const currentProfile = await DriverProfile.findOne({ userId: driverId });
        if (currentProfile && currentProfile.availabilityStatus === 'RESERVED') {
          await DriverProfile.updateOne({ userId: driverId }, { availabilityStatus: 'AVAILABLE' });
        }

        // Revert ride back to SEARCHING for the next candidate or to prompt loop retry
        await transitionRideStatus(rideId, 'SEARCHING');
      }
    }

    // Checked all available candidates, none accepted or timed out
    logger.warn(`[Dispatch] All matching driver candidates rejected or timed out for ride ${rideId}`);
    await transitionRideStatus(rideId, 'NO_DRIVER_FOUND');

  } catch (error) {
    logger.error(`[Dispatch] Error during automated matching loop: ${error.message}`);
  }
};

/**
 * Handle driver acceptance of a ride offer.
 */
export const handleDriverAccept = async (rideId, driverId) => {
  const { getRideById, transitionRideStatus } = await getRideService();
  const ride = await getRideById(rideId);

  if (!ride) {
    throw new NotFoundError('Ride not found');
  }

  if (ride.status !== 'DRIVER_OFFERED') {
    throw new BadRequestError('Ride is not in offered status.');
  }

  const assignedDriverId = ride.driverId?._id || ride.driverId;
  if (!assignedDriverId || assignedDriverId.toString() !== driverId.toString()) {
    throw new BadRequestError('This ride offer was not assigned to you.');
  }

  // Verify atomic reservation lock in Redis
  const lockKey = `driver:reservation:${driverId}`;
  const lockedRideId = await redisClient.get(lockKey);
  if (!lockedRideId || lockedRideId !== rideId.toString()) {
    throw new BadRequestError('Your reservation lock has expired or is invalid.');
  }

  // 1. Transition driver availability to ON_TRIP
  await DriverProfile.updateOne({ userId: driverId }, { availabilityStatus: 'ON_TRIP' });

  // 2. Transition Ride status to DRIVER_ASSIGNED
  await transitionRideStatus(rideId, 'DRIVER_ASSIGNED', { driverId });

  // 3. Delete reservation lock key
  await redisClient.del(lockKey);

  // 4. Notify dispatch loop of resolution
  dispatchEvents.emit(`offer_resolved_${rideId}`, { driverId, status: 'accepted' });
};

/**
 * Handle driver rejection of a ride offer.
 */
export const handleDriverReject = async (rideId, driverId) => {
  const { getRideById } = await getRideService();
  const ride = await getRideById(rideId);

  if (!ride) {
    throw new NotFoundError('Ride not found');
  }

  if (ride.status !== 'DRIVER_OFFERED') {
    throw new BadRequestError('Ride is not in offered status.');
  }

  const assignedDriverId = ride.driverId?._id || ride.driverId;
  if (!assignedDriverId || assignedDriverId.toString() !== driverId.toString()) {
    throw new BadRequestError('This ride offer was not assigned to you.');
  }

  // Notify dispatch loop of rejection immediately
  dispatchEvents.emit(`offer_resolved_${rideId}`, { driverId, status: 'rejected' });
};
