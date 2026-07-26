import axios from 'axios';
import { io } from 'socket.io-client';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:5000';
const DEFAULT_NUM_DRIVERS = 100;
const CENTER_LAT = 12.9716;
const CENTER_LNG = 77.5946;

// Parse command line arguments
const args = process.argv.slice(2);
let numDrivers = DEFAULT_NUM_DRIVERS;
args.forEach(arg => {
  if (arg.startsWith('--drivers=')) {
    numDrivers = parseInt(arg.split('=')[1]) || DEFAULT_NUM_DRIVERS;
  }
});

console.log(`==================================================`);
console.log(`🚀 Starting RideGrid Multi-Driver Simulation`);
console.log(`👥 Target Driver Scale: ${numDrivers}`);
console.log(`🔗 Backend API Base: ${API_BASE}`);
console.log(`🔗 WebSocket Server: ${SOCKET_URL}`);
console.log(`==================================================\n`);

// Helper to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to calculate intermediate GPS steps between two coordinates
const getGPSSteps = (startLat, startLng, endLat, endLng, numSteps) => {
  const steps = [];
  for (let i = 1; i <= numSteps; i++) {
    const ratio = i / numSteps;
    steps.push({
      latitude: startLat + (endLat - startLat) * ratio,
      longitude: startLng + (endLng - startLng) * ratio
    });
  }
  return steps;
};

class SimulatedDriver {
  constructor(index) {
    this.index = index;
    this.name = `Sim Driver ${index}`;
    this.email = `simdriver.${index}@example.com`;
    this.password = `simulated_driver_pass_123`;
    this.token = null;
    this.user = null;
    this.socket = null;
    
    // Spawn in a random location within ~5km of Bangalore center
    const latOffset = (Math.random() - 0.5) * 0.08;
    const lngOffset = (Math.random() - 0.5) * 0.08;
    this.latitude = CENTER_LAT + latOffset;
    this.longitude = CENTER_LNG + lngOffset;

    this.activeRide = null;
    this.isSimulatingTrip = false;
  }

  async initialize() {
    try {
      // 1. Register or Login
      try {
        const regRes = await axios.post(`${API_BASE}/auth/register`, {
          name: this.name,
          email: this.email,
          password: this.password,
          role: 'DRIVER'
        });
        this.token = regRes.data.data.accessToken;
        this.user = regRes.data.data.user;
      } catch (err) {
        if (err.response && (err.response.status === 409 || err.response.data.errorCode === 'EMAIL_ALREADY_EXISTS')) {
          // If already registered, login
          const loginRes = await axios.post(`${API_BASE}/auth/login`, {
            email: this.email,
            password: this.password
          });
          this.token = loginRes.data.data.accessToken;
          this.user = loginRes.data.data.user;
        } else {
          throw err;
        }
      }

      const headers = { 'Authorization': `Bearer ${this.token}` };

      // 2. Fetch driver profile to lazily initialize it
      const profileRes = await axios.get(`${API_BASE}/drivers/me`, { headers });
      const profile = profileRes.data.data;

      // 3. Register vehicle if not present
      if (!profile.vehicleId) {
        const vehicleClasses = ['BIKE', 'AUTO', 'ECONOMY', 'PREMIUM'];
        const randomClass = vehicleClasses[this.index % vehicleClasses.length];

        await axios.post(`${API_BASE}/drivers/me/vehicle`, {
          make: 'Toyota',
          model: 'Prius Sim',
          licensePlate: `SIM-PLATE-${this.index}`,
          type: randomClass,
          capacity: 4
        }, { headers });
      }

      // 4. Go Online
      await axios.post(`${API_BASE}/drivers/status`, { onlineStatus: 'ONLINE' }, { headers });

      // 5. Connect Socket.IO client
      this.socket = io(SOCKET_URL, {
        auth: { token: `Bearer ${this.token}` },
        transports: ['websocket']
      });

      this.socket.on('connect', () => {
        // Publish initial location update
        this.socket.emit('driver:location_update', {
          latitude: this.latitude,
          longitude: this.longitude
        });
      });

      // 6. Listen for incoming ride offers
      this.socket.on('ride:offer', async (offer) => {
        if (this.isSimulatingTrip || this.activeRide) {
          // If busy, auto-reject (though backend locks prevent this, safety check)
          this.socket.emit('ride:reject', { rideId: offer.rideId });
          return;
        }

        console.log(`[Driver ${this.index}] ⚡ Received Ride Offer for Ride ${offer.rideId.slice(-6).toUpperCase()} | Fare: $${offer.fare.toFixed(2)}`);
        
        // Response simulation: 90% accept / 10% reject
        const willAccept = Math.random() < 0.9;
        await delay(1000 + Math.random() * 1000); // 1-2s delay

        if (willAccept) {
          console.log(`[Driver ${this.index}] ✅ Accepting Offer for Ride ${offer.rideId.slice(-6).toUpperCase()}`);
          this.activeRide = offer;
          this.socket.emit('ride:accept', { rideId: offer.rideId });
          this.simulateTrip(offer);
        } else {
          console.log(`[Driver ${this.index}] ❌ Rejecting Offer for Ride ${offer.rideId.slice(-6).toUpperCase()}`);
          this.socket.emit('ride:reject', { rideId: offer.rideId });
        }
      });

      // Periodically update coordinates while idle
      this.startIdleWandering();

    } catch (err) {
      console.error(`❌ [Driver ${this.index}] Initialization failed: ${err.message}`);
    }
  }

  startIdleWandering() {
    setInterval(() => {
      if (this.isSimulatingTrip || this.activeRide || !this.socket || !this.socket.connected) {
        return;
      }

      // Drift coordinates slightly representing wandering around spawn point
      this.latitude += (Math.random() - 0.5) * 0.001;
      this.longitude += (Math.random() - 0.5) * 0.001;

      this.socket.emit('driver:location_update', {
        latitude: this.latitude,
        longitude: this.longitude
      });
    }, 10000);
  }

  async simulateTrip(ride) {
    this.isSimulatingTrip = true;
    const headers = { 'Authorization': `Bearer ${this.token}` };
    const rideId = ride.rideId;

    try {
      console.log(`[Driver ${this.index}] 🚗 Starting journey simulation for Ride ${rideId.slice(-6).toUpperCase()}`);

      // Step 1: DRIVER_ARRIVING - Approach Pickup Location
      await delay(2000);
      await axios.patch(`${API_BASE}/rides/${rideId}/status`, { status: 'DRIVER_ARRIVING' }, { headers });
      
      const pickupSteps = getGPSSteps(this.latitude, this.longitude, ride.pickup.latitude, ride.pickup.longitude, 3);
      for (const step of pickupSteps) {
        this.latitude = step.latitude;
        this.longitude = step.longitude;
        this.socket.emit('driver:location_update', {
          latitude: this.latitude,
          longitude: this.longitude
        });
        await delay(1500);
      }

      // Step 2: DRIVER_ARRIVED
      console.log(`[Driver ${this.index}] 📍 Arrived at pickup spot for Ride ${rideId.slice(-6).toUpperCase()}`);
      await axios.patch(`${API_BASE}/rides/${rideId}/status`, { status: 'DRIVER_ARRIVED' }, { headers });
      await delay(2000);

      // Step 3: IN_PROGRESS - Passenger onboard, driving to destination
      console.log(`[Driver ${this.index}] 🏁 Starting Passenger Trip for Ride ${rideId.slice(-6).toUpperCase()}`);
      await axios.patch(`${API_BASE}/rides/${rideId}/status`, { status: 'IN_PROGRESS' }, { headers });

      const destSteps = getGPSSteps(this.latitude, this.longitude, ride.destination.latitude, ride.destination.longitude, 5);
      for (const step of destSteps) {
        this.latitude = step.latitude;
        this.longitude = step.longitude;
        this.socket.emit('driver:location_update', {
          latitude: this.latitude,
          longitude: this.longitude
        });
        await delay(1500);
      }

      // Step 4: COMPLETED
      console.log(`[Driver ${this.index}] 🎉 Trip Completed successfully for Ride ${rideId.slice(-6).toUpperCase()}`);
      await axios.patch(`${API_BASE}/rides/${rideId}/status`, { status: 'COMPLETED' }, { headers });

    } catch (err) {
      console.error(`[Driver ${this.index}] ⚠️ Error during trip simulation: ${err.message}`);
    } finally {
      this.activeRide = null;
      this.isSimulatingTrip = false;
    }
  }
}

// Bootstrapping simulation manager
const drivers = [];
const startSimulation = async () => {
  console.log(`⏳ Initializing simulated drivers...`);
  
  // Registering drivers in throttled batches to avoid overloading bcrypt / MongoDB
  const BATCH_SIZE = 10;
  for (let i = 1; i <= numDrivers; i++) {
    const driver = new SimulatedDriver(i);
    drivers.push(driver);
    driver.initialize();

    if (i % BATCH_SIZE === 0) {
      // Small pause after batch to spread out authentication hashing loads
      await delay(1000);
      console.log(`Progress: Initialized ${i} / ${numDrivers} virtual drivers...`);
    }
  }

  console.log(`\n🎉 All ${numDrivers} simulated drivers initialized and wandering!\n`);
};

startSimulation();
