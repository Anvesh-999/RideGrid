import http from 'http';
import { io as Client } from 'socket.io-client';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { initSocket } from '../src/sockets/index.js';
import User from '../src/modules/users/user.model.js';
import { redisClient, connectRedis } from '../src/config/redis.js';

describe('Real-Time Location & Socket.IO Integration Tests', () => {
  let httpServer;
  let ioServer;
  let passengerToken;
  let driverToken;
  let driverUser;
  let passengerUser;
  let port;

  beforeAll(async () => {
    await connectRedis();
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';
      await mongoose.connect(mongoUri);
    }
    await User.deleteMany({});

    // Register & Login Passenger
    const pReg = await request(app).post('/api/auth/register').send({
      name: 'Passenger Socket',
      email: 'p-socket@example.com',
      password: 'password123',
      role: 'PASSENGER'
    });
    passengerUser = pReg.body.data.user;
    passengerToken = pReg.body.data.accessToken;

    // Register & Login Driver
    const dReg = await request(app).post('/api/auth/register').send({
      name: 'Driver Socket',
      email: 'd-socket@example.com',
      password: 'password123',
      role: 'DRIVER'
    });
    driverUser = dReg.body.data.user;
    driverToken = dReg.body.data.accessToken;

    // Spin up dynamic HTTP server and bind Socket.IO
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

  it('should deny Socket.IO connection if authorization token is missing', (done) => {
    const socket = Client(`http://localhost:${port}`, {
      reconnection: false
    });

    socket.on('connect_error', (err) => {
      expect(err.message).toBe('Authentication token required');
      socket.close();
      done();
    });
  });

  it('should deny Socket.IO connection if authorization token is invalid', (done) => {
    const socket = Client(`http://localhost:${port}`, {
      auth: { token: 'Bearer invalid-token' },
      reconnection: false
    });

    socket.on('connect_error', (err) => {
      expect(err.message).toBe('Invalid authentication token');
      socket.close();
      done();
    });
  });

  it('should permit Socket.IO connection for valid driver token', (done) => {
    const socket = Client(`http://localhost:${port}`, {
      auth: { token: `Bearer ${driverToken}` }
    });

    socket.on('connect', () => {
      expect(socket.connected).toBe(true);
      socket.close();
      done();
    });
  });

  it('should handle driver location updates, cache coordinates, and geo index in Redis', (done) => {
    const socket = Client(`http://localhost:${port}`, {
      auth: { token: `Bearer ${driverToken}` }
    });

    socket.on('connect', () => {
      // Emit location update event
      socket.emit('driver:location_update', {
        latitude: 40.7128,
        longitude: -74.006
      });

      // Allow slight delay for Redis storage operation to complete
      setTimeout(async () => {
        const driverId = driverUser.id || driverUser._id;

        // Check GEO index
        const nearest = await redisClient.geoSearch('drivers:geo', {
          longitude: -74.006,
          latitude: 40.7128
        }, { radius: 10 });
        
        expect(nearest).toContain(driverId.toString());

        // Check detailed location caching
        const detailsStr = await redisClient.get(`driver:location:${driverId}`);
        expect(detailsStr).toBeDefined();
        
        const details = JSON.parse(detailsStr);
        expect(details.latitude).toBe(40.7128);
        expect(details.longitude).toBe(-74.006);

        socket.close();
        done();
      }, 500);
    });
  });
});
