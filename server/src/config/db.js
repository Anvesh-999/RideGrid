import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';

  try {
    const conn = await mongoose.connect(mongoUri);

    logger.info(`[Database] MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);

    // Monitor connection events
    mongoose.connection.on('error', (err) => {
      logger.error(`[Database] MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('[Database] MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('[Database] MongoDB reconnected');
    });

  } catch (error) {
    logger.error(`[Database] MongoDB initial connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
