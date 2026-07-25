import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/modules/users/user.model.js';
import { redisClient } from '../src/config/redis.js';

describe('Auth Module - Registration', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';
      await mongoose.connect(mongoUri);
    }
  });

  afterAll(async () => {
    await mongoose.connection.close();
    await redisClient.quit();
  });

  beforeEach(async () => {
    // Clear user collection before each test to maintain clean test state
    await User.deleteMany({});
  });

  it('should successfully register a new user and generate tokens', async () => {
    const userData = {
      name: 'John Doe',
      email: 'john@example.com',
      password: 'password123',
      role: 'PASSENGER'
    };

    const res = await request(app)
      .post('/api/auth/register')
      .send(userData);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');

    // Check user values
    const { user } = res.body.data;
    expect(user.name).toBe(userData.name);
    expect(user.email).toBe(userData.email);
    expect(user.role).toBe(userData.role);
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('refreshToken');

    // Check database state
    const savedUser = await User.findOne({ email: userData.email }).select('+password +refreshToken');
    expect(savedUser).toBeTruthy();
    expect(savedUser.name).toBe(userData.name);
    expect(savedUser.role).toBe(userData.role);
    // Verify password is encrypted/hashed
    expect(savedUser.password).not.toBe(userData.password);
    expect(savedUser.refreshToken).toBe(res.body.data.refreshToken);
  });

  it('should return 400 validation error if registration fields are missing', async () => {
    const invalidData = {
      name: '',
      email: 'not-an-email',
      password: 'short'
    };

    const res = await request(app)
      .post('/api/auth/register')
      .send(invalidData);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toBeDefined();
    
    // Check fields failing validation
    const fields = res.body.error.details.map(d => d.field);
    expect(fields).toContain('name');
    expect(fields).toContain('email');
    expect(fields).toContain('password');
  });

  it('should return 409 conflict error if email is already in use', async () => {
    const userData = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'password123'
    };

    // Pre-register user
    await request(app)
      .post('/api/auth/register')
      .send(userData);

    // Try registering same email
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Jane Clone',
        email: 'jane@example.com',
        password: 'anotherpassword'
      });

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });
});

describe('Auth Module - Login', () => {
  const userData = {
    name: 'Login User',
    email: 'login@example.com',
    password: 'password123'
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';
      await mongoose.connect(mongoUri);
    }
  });

  afterAll(async () => {
    await mongoose.connection.close();
    await redisClient.quit();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    // Pre-register test user
    await request(app)
      .post('/api/auth/register')
      .send(userData);
  });

  it('should login successfully with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: userData.email,
        password: userData.password
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');

    const { user } = res.body.data;
    expect(user.email).toBe(userData.email);
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('refreshToken');
  });

  it('should return 401 unauthorized if password is incorrect', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: userData.email,
        password: 'wrongpassword'
      });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 unauthorized if email is not registered', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'unregistered@example.com',
        password: userData.password
      });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 400 validation error if input fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: '',
        password: ''
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
