import { BadRequestError } from '../../utils/errors.js';

// Configurable fare parameters per vehicle type
export const FARE_CONFIG = {
  BIKE: {
    baseFare: 2.0,      // $2.00 starting
    perKmRate: 0.5,     // $0.50 per kilometer
    perMinuteRate: 0.1, // $0.10 per minute
    capacity: 1
  },
  AUTO: {
    baseFare: 3.0,
    perKmRate: 0.8,
    perMinuteRate: 0.15,
    capacity: 3
  },
  ECONOMY: {
    baseFare: 4.0,
    perKmRate: 1.0,
    perMinuteRate: 0.2,
    capacity: 4
  },
  PREMIUM: {
    baseFare: 6.0,
    perKmRate: 1.5,
    perMinuteRate: 0.3,
    capacity: 4
  }
};

const AVERAGE_SPEED_KMPH = 30; // 30 km/h simulated average speed
const ROUTING_MULTIPLIER = 1.3; // Street network multiplier to simulate driving vs straight line distance

/**
 * Calculates distance in kilometers between two points using the Haversine formula
 */
export const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Estimate details (distance, duration, fare) between pickup and destination
 */
export const estimateRideDetails = (pickup, destination, vehicleType) => {
  const config = FARE_CONFIG[vehicleType];
  
  if (!config) {
    throw new BadRequestError(`Invalid vehicle type: ${vehicleType}`, 'INVALID_VEHICLE_TYPE');
  }

  const { latitude: lat1, longitude: lon1 } = pickup;
  const { latitude: lat2, longitude: lon2 } = destination;

  // Straight line distance
  const physicalDistance = calculateHaversineDistance(lat1, lon1, lat2, lon2);
  
  // Real world route estimate
  const estimatedDistance = Math.max(0.1, parseFloat((physicalDistance * ROUTING_MULTIPLIER).toFixed(2)));

  // Estimated travel time in minutes
  const estimatedDuration = Math.max(1, Math.round((estimatedDistance / AVERAGE_SPEED_KMPH) * 60));

  // Fare formula: base + (distance * distanceRate) + (duration * timeRate)
  const baseFare = config.baseFare;
  const distanceCost = estimatedDistance * config.perKmRate;
  const durationCost = estimatedDuration * config.perMinuteRate;
  const estimatedFare = parseFloat((baseFare + distanceCost + durationCost).toFixed(2));

  return {
    distance: estimatedDistance,
    duration: estimatedDuration,
    fare: estimatedFare,
    vehicleType
  };
};
