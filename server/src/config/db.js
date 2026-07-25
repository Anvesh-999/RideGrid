import mongoose from 'mongoose';

const connectDB = async () => {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ridegrid';

  try {
    const conn = await mongoose.connect(mongoUri);

    console.log(`[Database] MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);

    // Monitor connection events
    mongoose.connection.on('error', (err) => {
      console.error(`[Database] MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('[Database] MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('[Database] MongoDB reconnected');
    });

  } catch (error) {
    console.error(`[Database] MongoDB initial connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
