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
