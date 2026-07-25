import { createClient } from 'redis';
import logger from '../utils/logger.js';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Real Redis client with fast timeout options
const realRedisClient = createClient({
  url: redisUrl,
  socket: {
    connectTimeout: 1000,
    reconnectStrategy: (retries) => {
      if (retries >= 1) {
        // Stop reconnecting after first failure during bootstrap
        return new Error('Redis connection failed');
      }
      return 200;
    }
  }
});

// Mock Redis Client for local development fallback
class MockRedisClient {
  constructor() {
    this.store = new Map();
    this.geoStore = new Map();
    this.isReady = false;
    this.isOpen = false;
  }

  async connect() {
    this.isReady = true;
    this.isOpen = true;
    logger.info('[Cache] [MOCK] Resilient in-memory Mock Redis Client ready');
  }

  async quit() {
    this.isReady = false;
    this.isOpen = false;
    logger.info('[Cache] [MOCK] Mock Redis client connection closed.');
  }

  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, options = {}) {
    let expiresAt = null;
    if (options.EX) {
      expiresAt = Date.now() + options.EX * 1000;
    } else if (options.PX) {
      expiresAt = Date.now() + options.PX;
    }
    this.store.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async del(key) {
    const keys = Array.isArray(key) ? key : [key];
    let count = 0;
    for (const k of keys) {
      if (this.store.has(k)) {
        this.store.delete(k);
        count++;
      }
      if (this.geoStore.has(k)) {
        this.geoStore.delete(k);
        count++;
      }
    }
    return count;
  }

  async expire(key, seconds) {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  }

  async geoAdd(key, longitude, latitude, member) {
    // Note: Node Redis geoAdd can take an array or arguments. 
    // We support signature: geoAdd(key, longitude, latitude, member) 
    // and also geoAdd(key, { longitude, latitude, member })
    let item = {};
    if (typeof longitude === 'object') {
      item = {
        longitude: longitude.longitude,
        latitude: longitude.latitude,
        member: longitude.member
      };
    } else {
      item = { longitude, latitude, member };
    }

    if (!this.geoStore.has(key)) {
      this.geoStore.set(key, []);
    }
    const list = this.geoStore.get(key);
    const existingIndex = list.findIndex(i => i.member === item.member);
    if (existingIndex > -1) {
      list[existingIndex] = item;
    } else {
      list.push(item);
    }
    return 1;
  }

  async geoSearch(key, from, options = {}) {
    // signature matches redisClient.geoSearch(key, { longitude, latitude }, { radius, unit: 'km' })
    const list = this.geoStore.get(key) || [];
    const fromLon = from.longitude;
    const fromLat = from.latitude;
    const radius = options.radius || 10;

    // Haversine formula to compute distance in kilometers
    const getDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371; // Radius of earth in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const results = [];
    for (const item of list) {
      const dist = getDistance(fromLat, fromLon, item.latitude, item.longitude);
      if (dist <= radius) {
        results.push({
          member: item.member,
          distance: dist
        });
      }
    }

    // Sort by nearest distance
    results.sort((a, b) => a.distance - b.distance);

    // Return list of members
    return results.map(r => r.member);
  }
}

const mockRedisClient = new MockRedisClient();
let activeClient = realRedisClient;

// Wrapper client that delegates call to active client
const redisClient = {
  get isReady() { return activeClient.isReady; },
  get isOpen() { return activeClient.isOpen; },
  get(key) { return activeClient.get(key); },
  set(key, value, options) { return activeClient.set(key, value, options); },
  del(key) { return activeClient.del(key); },
  expire(key, seconds) { return activeClient.expire(key, seconds); },
  geoAdd(key, longitude, latitude, member) { return activeClient.geoAdd(key, longitude, latitude, member); },
  geoSearch(key, from, options) { return activeClient.geoSearch(key, from, options); },
  async quit() {
    if (activeClient && activeClient.isOpen) {
      try {
        await activeClient.quit();
      } catch (err) {
        // Silently catch error if client is already closed
      }
    }
  }
};

const connectRedis = async () => {
  realRedisClient.on('error', () => {
    // Suppress console crash on connection failure
  });

  try {
    logger.info('[Cache] Attempting to connect to Redis...');
    await realRedisClient.connect();
    logger.info('[Cache] Redis Connected successfully');
  } catch (error) {
    logger.warn(`[Cache] Redis connection failed: ${error.message}`);
    logger.warn('[Cache] Swapping to In-Memory Mock Redis Client');
    activeClient = mockRedisClient;
    await activeClient.connect();
  }
};

export { redisClient, connectRedis };
