import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { redisClient } from '../config/redis.js';
import logger from '../utils/logger.js';

let io = null;
const userSocketMap = new Map(); // Map of userId -> socketId

const getAccessSecret = () => process.env.JWT_ACCESS_SECRET || 'fallback_access_secret_123';

/**
 * Initialize Socket.IO server and mount authorization middleware
 */
export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for development
      methods: ['GET', 'POST']
    }
  });

  // Verify JWT on connection handshake
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
    
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const tokenString = token.startsWith('Bearer ') ? token.split(' ')[1] : token;

    try {
      const decoded = jwt.verify(tokenString, getAccessSecret());
      socket.user = decoded; // Contains { userId, email, role }
      next();
    } catch (err) {
      return next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.user;
    logger.info(`[Socket] Connection established. User ID: ${userId} (${role}), Socket ID: ${socket.id}`);

    // Map user ID to Socket ID
    userSocketMap.set(userId, socket.id);

    // Join room based on role or specific user ID
    if (role === 'DRIVER') {
      socket.join('drivers');
    }
    socket.join(`user:${userId}`);

    // Listen for realtime driver location updates
    socket.on('driver:location_update', async (data) => {
      if (role !== 'DRIVER') {
        return; // Only drivers can publish locations
      }

      const { latitude, longitude } = data;

      if (latitude === undefined || longitude === undefined) {
        return;
      }

      try {
        // 1. Index in Redis Geospatial structure for nearby discovery dispatches
        await redisClient.geoAdd('drivers:geo', longitude, latitude, userId);

        // 2. Cache specific driver detailed coordinate with short expiration
        const locationPayload = {
          latitude,
          longitude,
          timestamp: Date.now()
        };
        await redisClient.set(`driver:location:${userId}`, JSON.stringify(locationPayload), { EX: 60 });

        // 3. Broadcast update to any passenger tracking this specific driver (room format: `ride:tracking:${driverId}`)
        io.to(`ride:tracking:${userId}`).emit('ride:location_update', locationPayload);

      } catch (err) {
        logger.error(`[Socket] Location update failed for driver ${userId}: ${err.message}`);
      }
    });

    socket.on('disconnect', () => {
      logger.info(`[Socket] Connection disconnected. User ID: ${userId}, Socket ID: ${socket.id}`);
      userSocketMap.delete(userId);
    });
  });

  return io;
};

/**
 * Get initialized Socket.IO instance
 */
export const getIo = () => {
  if (!io) {
    throw new Error('Socket.IO is not initialized yet.');
  }
  return io;
};

/**
 * Send socket event directly to a user
 */
export const sendToUser = (userId, event, data) => {
  const socketId = userSocketMap.get(userId);
  if (socketId && io) {
    io.to(socketId).emit(event, data);
    return true;
  }
  return false;
};

/**
 * Force a user's socket to join a room
 */
export const joinRoom = (userId, roomName) => {
  const socketId = userSocketMap.get(userId);
  if (socketId && io) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.join(roomName);
      return true;
    }
  }
  return false;
};

/**
 * Force a user's socket to leave a room
 */
export const leaveRoom = (userId, roomName) => {
  const socketId = userSocketMap.get(userId);
  if (socketId && io) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.leave(roomName);
      return true;
    }
  }
  return false;
};
