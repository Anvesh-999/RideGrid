import http from 'http';
import { io as Client } from 'socket.io-client';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { initSocket } from '../src/sockets/index.js';
import User from '../src/modules/users/user.model.js';
import DriverProfile from '../src/modules/drivers/driverProfile.model.js';
import Vehicle from '../src/modules/vehicles/vehicle.model.js';
import Ride from '../src/modules/rides/ride.model.js';
import { redisClient, connectRedis } from '../src/config/redis.js';

describe('Geospatial Dispatch Engine Tests', () => {
  let httpServer;
  let ioServer;
  let passengerToken;
  let passengerUser;
  let driverToken;
  let driverUser;
  let port;

  beforeAll(async () => {
    // Speed up timeouts for matching in unit tests
    process.env.DISPATCH_OFFER_TIMEOUT = '300'; 

    await connectRedis();
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';
      await mongoose.connect(mongoUri);
    }

    // Bind server & sockets
    httpServer = http.createServer(app);
    ioServer = initSocket(httpServer);

    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        port = httpServer.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    ioServer.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await mongoose.connection.close();
    await redisClient.quit();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await DriverProfile.deleteMany({});
    await Vehicle.deleteMany({});
    await Ride.deleteMany({});
    await redisClient.del('drivers:geo');
  });

  const registerAndLogin = async (name, email, password, role) => {
    const reg = await request(app).post('/api/auth/register').send({ name, email, password, role });
    const user = reg.body.data.user;
    const token = reg.body.data.accessToken;
    return { user, token };
  };

  const setupDriver = async (name, email, plate) => {
    const dSetup = await registerAndLogin(name, email, 'pass123', 'DRIVER');
    
    // Lazily initialize profile by fetching /me
    await request(app)
      .get('/api/drivers/me')
      .set('Authorization', `Bearer ${dSetup.token}`);

    // Register vehicle
    await request(app)
      .post('/api/drivers/me/vehicle')
      .set('Authorization', `Bearer ${dSetup.token}`)
      .send({
        make: 'Tesla',
        model: 'Model Y',
        licensePlate: plate,
        type: 'ECONOMY',
        capacity: 4
      });

    // Go online (which sets status to AVAILABLE)
    await request(app)
      .post('/api/drivers/status')
      .set('Authorization', `Bearer ${dSetup.token}`)
      .send({ onlineStatus: 'ONLINE' });

    return dSetup;
  };

  it('should dispatch to nearest driver and accept successfully', async () => {
    // 1. Setup passenger and driver
    const pSetup = await registerAndLogin('Passenger 1', 'p1@example.com', 'pass123', 'PASSENGER');
    const dSetup = await setupDriver('Driver 1', 'd1@example.com', 'DISPATCH-1');

    // Connect driver socket to receive offers
    const driverSocket = Client(`http://localhost:${port}`, {
      auth: { token: `Bearer ${dSetup.token}` }
    });

    await new Promise((resolve) => {
      driverSocket.on('connect', () => {
        // Emit coordinates to index driver in Redis GEO
        driverSocket.emit('driver:location_update', {
          latitude: 12.9716,
          longitude: 77.5946
        });
        setTimeout(resolve, 300);
      });
    });

    // 2. Create passenger ride request
    const rideRes = await request(app)
      .post('/api/rides')
      .set('Authorization', `Bearer ${pSetup.token}`)
      .send({
        pickup: { address: 'Downtown Plaza', latitude: 12.9716, longitude: 77.5946 },
        destination: { address: 'Tech Park', latitude: 12.9279, longitude: 77.6271 },
        vehicleType: 'ECONOMY'
      });

    expect(rideRes.status).toBe(201);
    const rideId = rideRes.body.data._id;

    // Listen to driver socket for ride:offer
    let receivedOfferPromise = new Promise((resolve) => {
      driverSocket.on('ride:offer', (offer) => {
        expect(offer.rideId).toBe(rideId);
        expect(offer.fare).toBeDefined();
        resolve(offer);
      });
    });

    // Transition ride to SEARCHING to engage matching
    const transitionRes = await request(app)
      .patch(`/api/rides/${rideId}/status`)
      .set('Authorization', `Bearer ${pSetup.token}`)
      .send({ status: 'SEARCHING' });

    expect(transitionRes.status).toBe(200);

    // Wait for the socket offer
    await receivedOfferPromise;

    // Verify driver state is RESERVED
    const updatedDriver = await DriverProfile.findOne({ userId: dSetup.user.id || dSetup.user._id });
    expect(updatedDriver.availabilityStatus).toBe('RESERVED');

    // Verify ride status is DRIVER_OFFERED
    let ride = await Ride.findById(rideId);
    expect(ride.status).toBe('DRIVER_OFFERED');
    expect(ride.driverId.toString()).toBe(dSetup.user.id || dSetup.user._id);

    // 3. Driver accepts the offer
    const acceptRes = await request(app)
      .post(`/api/rides/${rideId}/accept`)
      .set('Authorization', `Bearer ${dSetup.token}`);

    expect(acceptRes.status).toBe(200);

    // Verify final states
    ride = await Ride.findById(rideId);
    expect(ride.status).toBe('DRIVER_ASSIGNED');

    const finalDriver = await DriverProfile.findOne({ userId: dSetup.user.id || dSetup.user._id });
    expect(finalDriver.availabilityStatus).toBe('ON_TRIP');

    // Close socket
    driverSocket.close();
  });

  it('should handle dispatch timeout and mark ride as NO_DRIVER_FOUND if no driver accepts', async () => {
    const pSetup = await registerAndLogin('Passenger 2', 'p2@example.com', 'pass123', 'PASSENGER');
    const dSetup = await setupDriver('Driver 2', 'd2@example.com', 'DISPATCH-2');

    const driverSocket = Client(`http://localhost:${port}`, {
      auth: { token: `Bearer ${dSetup.token}` }
    });

    await new Promise((resolve) => {
      driverSocket.on('connect', () => {
        driverSocket.emit('driver:location_update', {
          latitude: 12.9716,
          longitude: 77.5946
        });
        setTimeout(resolve, 200);
      });
    });

    // Create ride
    const rideRes = await request(app)
      .post('/api/rides')
      .set('Authorization', `Bearer ${pSetup.token}`)
      .send({
        pickup: { address: 'Downtown Plaza', latitude: 12.9716, longitude: 77.5946 },
        destination: { address: 'Tech Park', latitude: 12.9279, longitude: 77.6271 },
        vehicleType: 'ECONOMY'
      });

    const rideId = rideRes.body.data._id;

    // Trigger dispatch but DO NOT accept or reject (forces timeout)
    await request(app)
      .patch(`/api/rides/${rideId}/status`)
      .set('Authorization', `Bearer ${pSetup.token}`)
      .send({ status: 'SEARCHING' });

    // Wait for timeout (configured to 300ms + margin)
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Ride should have reached NO_DRIVER_FOUND after candidate loop fails
    const finalRide = await Ride.findById(rideId);
    expect(finalRide.status).toBe('NO_DRIVER_FOUND');

    // Driver should have returned to AVAILABLE
    const finalDriver = await DriverProfile.findOne({ userId: dSetup.user.id || dSetup.user._id });
    expect(finalDriver.availabilityStatus).toBe('AVAILABLE');

    driverSocket.close();
  });

  it('should prevent concurrent reservations and allow only ONE passenger to lock driver', async () => {
    // Passenger A and Passenger B
    const pASetup = await registerAndLogin('Passenger A', 'pa@example.com', 'pass123', 'PASSENGER');
    const pBSetup = await registerAndLogin('Passenger B', 'pb@example.com', 'pass123', 'PASSENGER');
    // Shared Driver
    const dSetup = await setupDriver('Driver C', 'dc@example.com', 'DISPATCH-C');

    // Connect driver socket
    const driverSocket = Client(`http://localhost:${port}`, {
      auth: { token: `Bearer ${dSetup.token}` }
    });

    await new Promise((resolve) => {
      driverSocket.on('connect', () => {
        driverSocket.emit('driver:location_update', {
          latitude: 12.9716,
          longitude: 77.5946
        });
        setTimeout(resolve, 200);
      });
    });

    // Create Ride A and Ride B concurrently
    const rideARes = await request(app)
      .post('/api/rides')
      .set('Authorization', `Bearer ${pASetup.token}`)
      .send({
        pickup: { address: 'Downtown Plaza', latitude: 12.9716, longitude: 77.5946 },
        destination: { address: 'Tech Park', latitude: 12.9279, longitude: 77.6271 },
        vehicleType: 'ECONOMY'
      });

    const rideBRes = await request(app)
      .post('/api/rides')
      .set('Authorization', `Bearer ${pBSetup.token}`)
      .send({
        pickup: { address: 'Downtown Plaza', latitude: 12.9716, longitude: 77.5946 },
        destination: { address: 'Tech Park', latitude: 12.9279, longitude: 77.6271 },
        vehicleType: 'ECONOMY'
      });

    const rideAId = rideARes.body.data._id;
    const rideBId = rideBRes.body.data._id;

    // Trigger dispatch simultaneously
    const triggerA = request(app)
      .patch(`/api/rides/${rideAId}/status`)
      .set('Authorization', `Bearer ${pASetup.token}`)
      .send({ status: 'SEARCHING' });

    const triggerB = request(app)
      .patch(`/api/rides/${rideBId}/status`)
      .set('Authorization', `Bearer ${pBSetup.token}`)
      .send({ status: 'SEARCHING' });

    // Await both triggers simultaneously
    await Promise.all([triggerA, triggerB]);

    // Small delay to let loops process
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify that only one ride obtained the offer, and the other is marked NO_DRIVER_FOUND
    const rideA = await Ride.findById(rideAId);
    const rideB = await Ride.findById(rideBId);

    const statuses = [rideA.status, rideB.status];
    expect(statuses).toContain('DRIVER_OFFERED');
    expect(statuses).toContain('NO_DRIVER_FOUND');

    // Verify Redis lock is held by the offered ride
    const driverId = dSetup.user.id || dSetup.user._id;
    const lockVal = await redisClient.get(`driver:reservation:${driverId}`);
    expect([rideAId, rideBId]).toContain(lockVal);

    driverSocket.close();
  });
});
