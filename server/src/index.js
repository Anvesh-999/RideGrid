import mongoose from 'mongoose';
import app from './app.js';
import connectDB from './config/db.js';
import { connectRedis, redisClient } from './config/redis.js';
import logger from './utils/logger.js';

const PORT = process.env.PORT || 5000;

// Initialize database & cache connections
await connectDB();
await connectRedis();

const server = app.listen(PORT, () => {
  logger.info(`[Server] RideGrid dispatch engine running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

// Handle graceful shutdown
const shutdown = async () => {
  logger.info('[Server] Gracefully shutting down...');
  
  try {
    await mongoose.connection.close();
    logger.info('[Database] MongoDB connection closed.');
  } catch (err) {
    logger.error(`[Database] Error closing MongoDB connection: ${err.message}`);
  }

  try {
    await redisClient.quit();
    logger.info('[Cache] Redis connection closed.');
  } catch (err) {
    logger.error(`[Cache] Error closing Redis connection: ${err.message}`);
  }

  server.close(() => {
    logger.info('[Server] Server closed. Process terminating.');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('[Server] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[Server] Unhandled Rejection', { promise, reason });
});

process.on('uncaughtException', (error) => {
  logger.error('[Server] Uncaught Exception', error);
  shutdown();
});
