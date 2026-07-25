import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/modules/users/user.model.js';
import Ride from '../src/modules/rides/ride.model.js';
import { redisClient } from '../src/config/redis.js';

describe('Ride Core Domain - Ride Lifecycle & Fare Endpoints', () => {
  let passengerToken;
  let driverToken;
  let driverUser;
  let passengerUser;
  let transitionRideStatus;

  beforeAll(async () => {
    // Dynamic import to fetch helper transition logic
    const rideServiceModule = await import('../src/modules/rides/ride.service.js');
    transitionRideStatus = rideServiceModule.transitionRideStatus;

    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';
      await mongoose.connect(mongoUri);
    }

    await User.deleteMany({});
    await Ride.deleteMany({});

    // Register & Login Passenger
    const pReg = await request(app).post('/api/auth/register').send({
      name: 'Passenger Alice',
      email: 'alice@example.com',
      password: 'password123',
      role: 'PASSENGER'
    });
    passengerUser = pReg.body.data.user;
    passengerToken = pReg.body.data.accessToken;

    // Register & Login Driver
    const dReg = await request(app).post('/api/auth/register').send({
      name: 'Driver Dave',
      email: 'dave@example.com',
      password: 'password123',
      role: 'DRIVER'
    });
    driverUser = dReg.body.data.user;
    driverToken = dReg.body.data.accessToken;
  });

  afterAll(async () => {
    await mongoose.connection.close();
    await redisClient.quit();
  });

  describe('POST /api/rides/estimate', () => {
    it('should calculate estimated distance, duration, and fare for ECONOMY', async () => {
      const payload = {
        pickup: { address: 'Central Park', latitude: 40.785091, longitude: -73.968285 },
        destination: { address: 'Times Square', latitude: 40.758896, longitude: -73.985130 },
        vehicleType: 'ECONOMY'
      };

      const res = await request(app)
        .post('/api/rides/estimate')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send(payload);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.distance).toBeGreaterThan(0.5);
      expect(res.body.data.duration).toBeGreaterThan(1);
      expect(res.body.data.fare).toBeGreaterThan(4.0); // Base fare of economy is 4.0
    });
  });

  describe('POST /api/rides', () => {
    it('should create a ride request successfully', async () => {
      const payload = {
        pickup: { address: 'Central Park', latitude: 40.785091, longitude: -73.968285 },
        destination: { address: 'Times Square', latitude: 40.758896, longitude: -73.985130 },
        vehicleType: 'PREMIUM'
      };

      const res = await request(app)
        .post('/api/rides')
        .set('Authorization', `Bearer ${passengerToken}`)
        .send(payload);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('REQUESTED');
      expect(res.body.data.passengerId).toBe(passengerUser.id || passengerUser._id);
      expect(res.body.data.vehicleType).toBe('PREMIUM');
      expect(res.body.data.fare).toBeGreaterThan(6.0); // Premium base is 6.0
    });

    it('should deny ride requests from non-passenger roles', async () => {
      const payload = {
        pickup: { address: 'Central Park', latitude: 40.785091, longitude: -73.968285 },
        destination: { address: 'Times Square', latitude: 40.758896, longitude: -73.985130 },
        vehicleType: 'ECONOMY'
      };

      const res = await request(app)
        .post('/api/rides')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(payload);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('State Machine & Transitions', () => {
    let testRide;

    beforeEach(async () => {
      // Setup a fresh ride for state transitions
      const ride = new Ride({
        passengerId: passengerUser.id || passengerUser._id,
        pickup: { address: 'Point A', latitude: 40.0, longitude: -70.0 },
        destination: { address: 'Point B', latitude: 40.1, longitude: -70.1 },
        vehicleType: 'ECONOMY',
        fare: 15.0,
        distance: 5.0,
        duration: 10
      });
      testRide = await ride.save();
    });

    it('should transition status through valid sequence and reject invalid transitions', async () => {
      // Valid transition: REQUESTED -> SEARCHING
      let updatedRide = await transitionRideStatus(testRide._id, 'SEARCHING');
      expect(updatedRide.status).toBe('SEARCHING');

      // Invalid transition: SEARCHING -> IN_PROGRESS (Must go through driver assigned first)
      await expect(
        transitionRideStatus(testRide._id, 'IN_PROGRESS')
      ).rejects.toThrow('Invalid ride status transition');

      // Valid: SEARCHING -> DRIVER_OFFERED
      updatedRide = await transitionRideStatus(testRide._id, 'DRIVER_OFFERED');
      expect(updatedRide.status).toBe('DRIVER_OFFERED');

      // Valid: DRIVER_OFFERED -> DRIVER_ASSIGNED
      updatedRide = await transitionRideStatus(testRide._id, 'DRIVER_ASSIGNED', {
        driverId: driverUser.id || driverUser._id
      });
      expect(updatedRide.status).toBe('DRIVER_ASSIGNED');
      expect(updatedRide.driverId._id.toString()).toBe(driverUser.id || driverUser._id);
      expect(updatedRide.assignedAt).toBeDefined();

      // Valid: DRIVER_ASSIGNED -> DRIVER_ARRIVING
      updatedRide = await transitionRideStatus(testRide._id, 'DRIVER_ARRIVING');
      expect(updatedRide.status).toBe('DRIVER_ARRIVING');

      // Valid: DRIVER_ARRIVING -> DRIVER_ARRIVED
      updatedRide = await transitionRideStatus(testRide._id, 'DRIVER_ARRIVED');
      expect(updatedRide.status).toBe('DRIVER_ARRIVED');
      expect(updatedRide.arrivedAt).toBeDefined();

      // Valid: DRIVER_ARRIVED -> IN_PROGRESS
      updatedRide = await transitionRideStatus(testRide._id, 'IN_PROGRESS');
      expect(updatedRide.status).toBe('IN_PROGRESS');
      expect(updatedRide.startedAt).toBeDefined();

      // Valid: IN_PROGRESS -> COMPLETED
      updatedRide = await transitionRideStatus(testRide._id, 'COMPLETED');
      expect(updatedRide.status).toBe('COMPLETED');
      expect(updatedRide.completedAt).toBeDefined();

      // Reject transition once COMPLETED (e.g. COMPLETED -> IN_PROGRESS)
      await expect(
        transitionRideStatus(testRide._id, 'IN_PROGRESS')
      ).rejects.toThrow('Invalid ride status transition');
    });

    it('should allow cancellation at SEARCHING state', async () => {
      // REQUESTED -> SEARCHING
      await transitionRideStatus(testRide._id, 'SEARCHING');

      // Cancel
      const res = await request(app)
        .post(`/api/rides/${testRide._id}/cancel`)
        .set('Authorization', `Bearer ${passengerToken}`)
        .send({ reason: 'Changed mind' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('CANCELLED');
      expect(res.body.data.cancellation.actor).toBe('PASSENGER');
      expect(res.body.data.cancellation.reason).toBe('Changed mind');
    });
  });
});
