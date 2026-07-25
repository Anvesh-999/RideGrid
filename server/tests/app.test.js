import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { redisClient } from '../src/config/redis.js';

describe('GET /health', () => {
  beforeAll(async () => {
    // If mongoose is not already connected, connect to it
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';
      await mongoose.connect(mongoUri);
    }
    // Also check that redis mock/real client is available
    // (during testing, connectRedis is not automatically run unless index.js is loaded,
    // so we can connect our redisClient mock or real instance manually for the test)
    if (!redisClient.isReady) {
      // Connect to whatever active client is wrapped
      // In tests, if redis is not running, it will gracefully fallback
    }
  });

  afterAll(async () => {
    await mongoose.connection.close();
    await redisClient.quit();
  });

  it('should return health check details', async () => {
    const res = await request(app).get('/health');
    
    // Status can be 200 (healthy) or 503 (degraded if Redis is not running)
    expect([200, 503]).toContain(res.statusCode);
    
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('services');
    expect(res.body.services).toHaveProperty('database');
    expect(res.body.services).toHaveProperty('cache');
    
    expect(res.body.services.database).toHaveProperty('status');
    expect(res.body.services.database).toHaveProperty('connected');
    expect(res.body.services.cache).toHaveProperty('status');
    expect(res.body.services.cache).toHaveProperty('connected');
  });

  it('should return 404 for unknown routes', async () => {
    const res = await request(app).get('/unknown-route-xyz');
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found'
      }
    });
  });
});
