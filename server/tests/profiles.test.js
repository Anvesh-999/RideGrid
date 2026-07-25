import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/modules/users/user.model.js';
import PassengerProfile from '../src/modules/passengers/passengerProfile.model.js';
import { redisClient } from '../src/config/redis.js';

describe('Passenger Domain - Profile Endpoints', () => {
  let passengerToken;
  let driverToken;
  let passengerUser;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';
      await mongoose.connect(mongoUri);
    }

    await User.deleteMany({});
    await PassengerProfile.deleteMany({});

    // Register & Login Passenger
    const pReg = await request(app).post('/api/auth/register').send({
      name: 'Passenger Bob',
      email: 'bob@example.com',
      password: 'password123',
      role: 'PASSENGER'
    });
    passengerUser = pReg.body.data.user;
    passengerToken = pReg.body.data.accessToken;

    // Register & Login Driver
    const dReg = await request(app).post('/api/auth/register').send({
      name: 'Driver Dan',
      email: 'dan@example.com',
      password: 'password123',
      role: 'DRIVER'
    });
    driverToken = dReg.body.data.accessToken;
  });

  afterAll(async () => {
    await mongoose.connection.close();
    await redisClient.quit();
  });

  it('should deny access if authorization header is missing', async () => {
    const res = await request(app).get('/api/passengers/me');
    expect(res.statusCode).toBe(401);
  });

  it('should deny access if logged in as a driver', async () => {
    const res = await request(app)
      .get('/api/passengers/me')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.statusCode).toBe(403);
  });

  it('should get current passenger profile (lazily initialized)', async () => {
    const res = await request(app)
      .get('/api/passengers/me')
      .set('Authorization', `Bearer ${passengerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('userId');
    expect(res.body.data.userId.email).toBe('bob@example.com');
    expect(res.body.data.savedLocations).toEqual([]);
    expect(res.body.data.phoneNumber).toBe('');
  });

  it('should update passenger profile with phone number and saved locations', async () => {
    const updates = {
      phoneNumber: '+15551234',
      savedLocations: [
        {
          label: 'Home',
          address: '123 Main St, Cityville',
          latitude: 40.7128,
          longitude: -74.006
        },
        {
          label: 'Work',
          address: '456 Commerce Ave, Cityville',
          latitude: 40.7306,
          longitude: -73.9352
        }
      ]
    };

    const res = await request(app)
      .patch('/api/passengers/me')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send(updates);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.phoneNumber).toBe(updates.phoneNumber);
    expect(res.body.data.savedLocations).toHaveLength(2);
    expect(res.body.data.savedLocations[0].label).toBe('Home');
    expect(res.body.data.savedLocations[1].label).toBe('Work');

    // Verify DB update
    const profileInDb = await PassengerProfile.findOne({ userId: passengerUser.id || passengerUser._id });
    expect(profileInDb.phoneNumber).toBe(updates.phoneNumber);
    expect(profileInDb.savedLocations).toHaveLength(2);
  });

  it('should reject invalid coordinates in saved locations', async () => {
    const invalidUpdates = {
      savedLocations: [
        {
          label: 'Invalid Place',
          address: 'Somewhere',
          latitude: 95.0, // Invalid latitude (> 90)
          longitude: -74.006
        }
      ]
    };

    const res = await request(app)
      .patch('/api/passengers/me')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send(invalidUpdates);

    // Mongoose validation should throw a validation error resulting in a 500 or caught by errorHandler
    // Since it's a db validation error, it will be treated as an unexpected server error unless handled
    // errorHandler maps it to 500 or we map Mongoose errors in errorHandler. Let's assert it fails.
    expect(res.statusCode).toBe(500); // DB validation failure
    expect(res.body.success).toBe(false);
  });
});

describe('Driver Domain - Profile & Vehicle Endpoints', () => {
  let passengerToken;
  let driverToken;
  let driverUser;
  let DriverProfile;
  let Vehicle;

  beforeAll(async () => {
    const driverProfileModule = await import('../src/modules/drivers/driverProfile.model.js');
    DriverProfile = driverProfileModule.default;
    const vehicleModule = await import('../src/modules/vehicles/vehicle.model.js');
    Vehicle = vehicleModule.default;

    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';
      await mongoose.connect(mongoUri);
    }

    await User.deleteMany({});
    await DriverProfile.deleteMany({});
    await Vehicle.deleteMany({});

    // Register & Login Passenger
    const pReg = await request(app).post('/api/auth/register').send({
      name: 'Passenger Bob',
      email: 'bob@example.com',
      password: 'password123',
      role: 'PASSENGER'
    });
    passengerToken = pReg.body.data.accessToken;

    // Register & Login Driver
    const dReg = await request(app).post('/api/auth/register').send({
      name: 'Driver Dan',
      email: 'dan@example.com',
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

  it('should deny driver endpoint access to passengers', async () => {
    const res = await request(app)
      .get('/api/drivers/me')
      .set('Authorization', `Bearer ${passengerToken}`);
    expect(res.statusCode).toBe(403);
  });

  it('should get current driver profile (lazily initialized)', async () => {
    const res = await request(app)
      .get('/api/drivers/me')
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.onlineStatus).toBe('OFFLINE');
    expect(res.body.data.availabilityStatus).toBe('OFFLINE');
    expect(res.body.data.vehicleId).toBeNull();
  });

  it('should reject status update to ONLINE if no vehicle is registered', async () => {
    const res = await request(app)
      .post('/api/drivers/status')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ onlineStatus: 'ONLINE' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('VEHICLE_REQUIRED');
  });

  it('should register a vehicle successfully for the driver', async () => {
    const vehicleData = {
      make: 'Toyota',
      model: 'Prius',
      licensePlate: 'ABC1234',
      type: 'ECONOMY',
      capacity: 4
    };

    const res = await request(app)
      .post('/api/drivers/me/vehicle')
      .set('Authorization', `Bearer ${driverToken}`)
      .send(vehicleData);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.make).toBe(vehicleData.make);
    expect(res.body.data.licensePlate).toBe(vehicleData.licensePlate);

    // Verify linkage in DriverProfile
    const profile = await DriverProfile.findOne({ userId: driverUser.id || driverUser._id });
    expect(profile.vehicleId).toBeDefined();
    expect(profile.vehicleId.toString()).toBe(res.body.data._id);
  });

  it('should allow driver to go ONLINE/AVAILABLE once a vehicle is registered', async () => {
    const res = await request(app)
      .post('/api/drivers/status')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ onlineStatus: 'ONLINE' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.onlineStatus).toBe('ONLINE');
    expect(res.body.data.availabilityStatus).toBe('AVAILABLE');
  });

  it('should reject invalid status transitions (e.g. AVAILABLE to ON_TRIP directly)', async () => {
    const res = await request(app)
      .post('/api/drivers/status')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ availabilityStatus: 'ON_TRIP' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });

  it('should allow valid transitions (e.g. AVAILABLE to RESERVED)', async () => {
    const res = await request(app)
      .post('/api/drivers/status')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ availabilityStatus: 'RESERVED' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.availabilityStatus).toBe('RESERVED');
  });
});
