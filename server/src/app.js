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
