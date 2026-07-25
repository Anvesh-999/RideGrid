import mongoose from 'mongoose';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { redisClient } from './config/redis.js';
import requestId from './middlewares/requestId.js';
import errorHandler from './middlewares/errorHandler.js';
import logger from './utils/logger.js';
import { NotFoundError } from './utils/errors.js';
import authRoutes from './modules/auth/auth.routes.js';
import passengerRoutes from './modules/passengers/passenger.routes.js';
import driverRoutes from './modules/drivers/driver.routes.js';
import rideRoutes from './modules/rides/ride.routes.js';
import { authenticate, authorize } from './modules/auth/auth.middleware.js';

// Load environment variables
dotenv.config();

const app = express();

// Set up request ID tracing and logging first
app.use(requestId);
app.use((req, res, next) => {
  logger.info(`[HTTP] Incoming ${req.method} ${req.path}`, { requestId: req.id });
  next();
});

// Security & Parsing Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Register routes
app.use('/api/auth', authRoutes);
app.use('/api/passengers', passengerRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/rides', rideRoutes);

// Test endpoints for Auth/RBAC validation
if (process.env.NODE_ENV === 'test') {
  app.get('/api/test/auth-only', authenticate, (req, res) => {
    res.status(200).json({ success: true, message: 'Authenticated', user: req.user });
  });
  
  app.get('/api/test/driver-only', authenticate, authorize('DRIVER'), (req, res) => {
    res.status(200).json({ success: true, message: 'Driver access granted' });
  });

  app.get('/api/test/admin-only', authenticate, authorize('ADMIN'), (req, res) => {
    res.status(200).json({ success: true, message: 'Admin access granted' });
  });
}

// Basic Health Check Route
app.get('/health', (req, res) => {
  const dbStatus = mongoose.connection.readyState;
  const dbStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  const isDbConnected = dbStatus === 1;
  const isRedisConnected = redisClient.isReady;

  const isHealthy = isDbConnected && isRedisConnected;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DEGRADED',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: {
        status: dbStates[dbStatus] || 'unknown',
        connected: isDbConnected
      },
      cache: {
        status: isRedisConnected ? 'connected' : 'disconnected',
        connected: isRedisConnected
      }
    }
  });
});

// Fallback Route for 404 (throws NotFoundError to be caught by errorHandler)
app.use((req, res, next) => {
  next(new NotFoundError());
});

// Centralized Error Handler
app.use(errorHandler);

export default app;
