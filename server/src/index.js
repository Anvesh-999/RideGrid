import mongoose from 'mongoose';
import app from './app.js';
import connectDB from './config/db.js';

const PORT = process.env.PORT || 5000;

// Initialize database connection
await connectDB();

const server = app.listen(PORT, () => {
  console.log(`[Server] RideGrid dispatch engine running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

// Handle graceful shutdown
const shutdown = async () => {
  console.log('[Server] Gracefully shutting down...');
  
  try {
    await mongoose.connection.close();
    console.log('[Database] MongoDB connection closed.');
  } catch (err) {
    console.error(`[Database] Error closing MongoDB connection: ${err.message}`);
  }

  server.close(() => {
    console.log('[Server] Server closed. Process terminating.');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  shutdown();
});
