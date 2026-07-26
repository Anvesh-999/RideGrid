import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

// Coordinate presets to make manual testing super easy and fun
const COORD_PRESETS = [
  {
    name: 'Downtown to Tech Park',
    pickup: { address: 'Downtown Plaza', lat: 12.9716, lng: 77.5946 },
    destination: { address: 'Tech Park Zone C', lat: 12.9279, lng: 77.6271 }
  },
  {
    name: 'Airport to City Center',
    pickup: { address: 'International Airport', lat: 13.1986, lng: 77.7066 },
    destination: { address: 'Grand Galleria Mall', lat: 12.9801, lng: 77.5896 }
  },
  {
    name: 'Suburb to Railway Station',
    pickup: { address: 'Greenwood Suburbia', lat: 12.8904, lng: 77.5023 },
    destination: { address: 'Central Railway Station', lat: 12.9783, lng: 77.5694 }
  }
];

function App() {
  // Authentication & Session
  const [isRegister, setIsRegister] = useState(false);
  const [token, setToken] = useState(localStorage.getItem('rg_token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('rg_user') || 'null'));
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', role: 'PASSENGER' });
  const [authError, setAuthError] = useState('');
  
  // Real-time Connection
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);

  // Passenger UI States
  const [pickup, setPickup] = useState({ address: '', lat: 12.9716, lng: 77.5946 });
  const [destination, setDestination] = useState({ address: '', lat: 12.9279, lng: 77.6271 });
  const [vehicleType, setVehicleType] = useState('ECONOMY');
  const [estimate, setEstimate] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [activeRide, setActiveRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);

  // Driver UI States
  const [vehicle, setVehicle] = useState(null);
  const [vehicleForm, setVehicleForm] = useState({ licensePlate: '', model: '', color: '', type: 'ECONOMY' });
  const [availability, setAvailability] = useState('OFFLINE');
  const [searchingRides, setSearchingRides] = useState([]);
  const [activeDriverRide, setActiveDriverRide] = useState(null);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [driverSimCoords, setDriverSimCoords] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const simulationInterval = useRef(null);

  // Auto-connect socket if token is present
  useEffect(() => {
    if (token && user) {
      const socketClient = io(SOCKET_URL, {
        auth: { token: `Bearer ${token}` }
      });

      socketClient.on('connect', () => {
        setSocketConnected(true);
        console.log('[Socket] Connected to server');
      });

      socketClient.on('disconnect', () => {
        setSocketConnected(false);
        console.log('[Socket] Disconnected from server');
      });

      // Listen for ride status changes (emitted by server status transition API)
      socketClient.on('ride:status_changed', (updatedRide) => {
        console.log('[Socket] Ride status changed:', updatedRide);
        if (user.role === 'PASSENGER') {
          setActiveRide(updatedRide);
          if (updatedRide.status === 'COMPLETED' || updatedRide.status === 'CANCELLED') {
            setDriverLocation(null);
          }
        } else {
          if (updatedRide.status === 'CANCELLED' || updatedRide.status === 'NO_DRIVER_FOUND') {
            setIncomingOffer(null);
            setActiveDriverRide(null);
          } else {
            setActiveDriverRide(updatedRide);
          }
        }
      });

      // Listen for incoming ride offers
      socketClient.on('ride:offer', (offer) => {
        console.log('[Socket] Incoming ride offer:', offer);
        setIncomingOffer(offer);
      });

      // Listen for driver location tracking updates
      socketClient.on('ride:location_update', (location) => {
        console.log('[Socket] Driver location update received:', location);
        setDriverLocation(location);
      });

      setSocket(socketClient);

      // Fetch initial details
      fetchProfileDetails();

      return () => {
        socketClient.disconnect();
      };
    }
  }, [token]);

  // Load dashboard context updates
  useEffect(() => {
    if (!token || !user) return;

    if (user.role === 'DRIVER') {
      fetchDriverProfile();
      // Poll active searching rides for the driver to pick up
      const interval = setInterval(fetchSearchingRides, 5000);
      fetchSearchingRides();
      return () => clearInterval(interval);
    } else {
      // Find if passenger has any active ride
      fetchActivePassengerRides();
    }
  }, [token, user?.role]);

  // Handle auto-simulation pathing
  useEffect(() => {
    if (isSimulating && activeDriverRide && socket) {
      const pickupLat = activeDriverRide.pickup.latitude;
      const pickupLng = activeDriverRide.pickup.longitude;
      const destLat = activeDriverRide.destination.latitude;
      const destLng = activeDriverRide.destination.longitude;
      
      let step = 0;
      const totalSteps = 20;

      simulationInterval.current = setInterval(() => {
        step++;
        let currentLat, currentLng;

        // Stage 1: Move from driver's start location to pickup (if driver is arriving)
        if (activeDriverRide.status === 'DRIVER_ARRIVING') {
          const startLat = driverSimCoords ? driverSimCoords.latitude : pickupLat - 0.01;
          const startLng = driverSimCoords ? driverSimCoords.longitude : pickupLng - 0.01;
          
          const progress = Math.min(step / totalSteps, 1);
          currentLat = startLat + (pickupLat - startLat) * progress;
          currentLng = startLng + (pickupLng - startLng) * progress;
          
          if (progress >= 1) {
            clearInterval(simulationInterval.current);
            setIsSimulating(false);
          }
        } 
        // Stage 2: Move from pickup to destination (if ride is in progress)
        else if (activeDriverRide.status === 'IN_PROGRESS') {
          const progress = Math.min(step / totalSteps, 1);
          currentLat = pickupLat + (destLat - pickupLat) * progress;
          currentLng = pickupLng + (destLng - pickupLng) * progress;

          if (progress >= 1) {
            clearInterval(simulationInterval.current);
            setIsSimulating(false);
          }
        } else {
          clearInterval(simulationInterval.current);
          setIsSimulating(false);
          return;
        }

        const newCoords = { latitude: currentLat, longitude: currentLng, timestamp: Date.now() };
        setDriverSimCoords(newCoords);
        socket.emit('driver:location_update', newCoords);

      }, 1500);

      return () => {
        if (simulationInterval.current) clearInterval(simulationInterval.current);
      };
    }
  }, [isSimulating, activeDriverRide?.status]);

  // Auth Operations
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = isRegister ? '/register' : '/login';
    const payload = isRegister 
      ? authForm 
      : { email: authForm.email, password: authForm.password };

    try {
      const response = await fetch(`${API_BASE}/auth${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const resData = await response.json();
      if (!resData.success) {
        setAuthError(resData.error?.message || 'Authentication failed');
        return;
      }

      const { accessToken, user: loggedUser } = resData.data;
      localStorage.setItem('rg_token', accessToken);
      localStorage.setItem('rg_user', JSON.stringify(loggedUser));
      
      setToken(accessToken);
      setUser(loggedUser);
    } catch (err) {
      setAuthError('Connection failed. Please ensure the backend is running.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('rg_token');
    localStorage.removeItem('rg_user');
    setToken('');
    setUser(null);
    setSocket(null);
    setActiveRide(null);
    setDriverLocation(null);
    setActiveDriverRide(null);
    setVehicle(null);
    setAvailability('OFFLINE');
    if (simulationInterval.current) clearInterval(simulationInterval.current);
  };

  // API fetches
  const fetchProfileDetails = async () => {
    // Basic verification fetch
  };

  const fetchDriverProfile = async () => {
    try {
      // Get driver profile details (lazily created if missing)
      const res = await fetch(`${API_BASE}/drivers/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const resData = await res.json();
      if (resData.success) {
        setVehicle(resData.data.vehicleId);
        setAvailability(resData.data.availability);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchActivePassengerRides = async () => {
    try {
      const res = await fetch(`${API_BASE}/rides`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const resData = await res.json();
      if (resData.success && resData.data.length > 0) {
        // Find most recent active ride
        const active = resData.data.find(r => !['COMPLETED', 'CANCELLED', 'NO_DRIVER_FOUND'].includes(r.status));
        if (active) {
          setActiveRide(active);
          // If already assigned and moving, listen
          if (active.driverId && active.status !== 'REQUESTED') {
            // join tracking room
            if (socket) {
              const driverId = active.driverId._id || active.driverId;
              socket.emit('join', { room: `ride:tracking:${driverId}` });
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSearchingRides = async () => {
    try {
      const res = await fetch(`${API_BASE}/rides?status=SEARCHING`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const resData = await res.json();
      if (resData.success) {
        setSearchingRides(resData.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Preset Applicator
  const applyPreset = (preset) => {
    setPickup(preset.pickup);
    setDestination(preset.destination);
    setEstimate(null);
  };

  // Passenger Book Actions
  const handleGetEstimate = async () => {
    setEstimateLoading(true);
    setEstimate(null);
    try {
      const res = await fetch(`${API_BASE}/rides/estimate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          pickup: { address: pickup.address, latitude: pickup.lat, longitude: pickup.lng },
          destination: { address: destination.address, latitude: destination.lat, longitude: destination.lng },
          vehicleType
        })
      });
      const resData = await res.json();
      if (resData.success) {
        setEstimate(resData.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEstimateLoading(false);
    }
  };

  const handleBookRide = async () => {
    try {
      const res = await fetch(`${API_BASE}/rides`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          pickup: { address: pickup.address, latitude: pickup.lat, longitude: pickup.lng },
          destination: { address: destination.address, latitude: destination.lat, longitude: destination.lng },
          vehicleType
        })
      });
      const resData = await res.json();
      if (resData.success) {
        const ride = resData.data;
        setActiveRide(ride);
        // Automatically request transition to SEARCHING to simulate matching
        await transitionRideStatus(ride._id, 'SEARCHING');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancelRide = async (rideId) => {
    try {
      const res = await fetch(`${API_BASE}/rides/${rideId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reason: 'Passenger cancelled via dashboard.' })
      });
      const resData = await res.json();
      if (resData.success) {
        setActiveRide(null);
        setDriverLocation(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Driver Actions
  const handleRegisterVehicle = async (e) => {
    e.preventDefault();
    try {
      const modelParts = vehicleForm.model.trim().split(' ');
      const make = modelParts[0] || 'Generic';
      const capacity = vehicleForm.type === 'BIKE' ? 1 : (vehicleForm.type === 'AUTO' ? 3 : 4);

      const payload = {
        ...vehicleForm,
        make,
        capacity
      };

      const res = await fetch(`${API_BASE}/drivers/me/vehicle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (resData.success) {
        setVehicle(resData.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAvailabilityToggle = async (target) => {
    try {
      const res = await fetch(`${API_BASE}/drivers/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ availability: target })
      });
      const resData = await res.json();
      if (resData.success) {
        setAvailability(resData.data.availability);
      } else {
        alert(resData.error?.message || 'Error changing status');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAcceptRideOffer = async (rideId) => {
    try {
      const res = await fetch(`${API_BASE}/rides/${rideId}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const resData = await res.json();
      if (resData.success) {
        const ride = resData.data;
        setActiveDriverRide(ride);
        setIncomingOffer(null);
        setDriverSimCoords({
          latitude: ride.pickup.latitude - 0.008,
          longitude: ride.pickup.longitude - 0.008
        });
        
        // Connect to tracking room via sockets
        if (socket) {
          socket.emit('join', { room: `ride:tracking:${user._id || user.id}` });
        }
      } else {
        alert(resData.error?.message || 'Accept error');
        setIncomingOffer(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRejectRideOffer = async (rideId) => {
    try {
      const res = await fetch(`${API_BASE}/rides/${rideId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      const resData = await res.json();
      if (resData.success) {
        setIncomingOffer(null);
      } else {
        alert(resData.error?.message || 'Reject error');
        setIncomingOffer(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const transitionRideStatus = async (rideId, status, driverId = null) => {
    try {
      const payload = { status };
      if (driverId) payload.driverId = driverId;

      const res = await fetch(`${API_BASE}/rides/${rideId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();
      if (resData.success) {
        if (user.role === 'DRIVER') {
          setActiveDriverRide(resData.data);
          if (status === 'COMPLETED' || status === 'CANCELLED') {
            setActiveDriverRide(null);
            setDriverSimCoords(null);
            setIsSimulating(false);
          }
        } else {
          setActiveRide(resData.data);
        }
        return resData.data;
      } else {
        alert(resData.error?.message || 'Transition error');
      }
    } catch (err) {
      console.error(err);
    }
    return null;
  };

  // Helper renderer for dynamic map plotting
  const renderMapVisual = () => {
    // Determine map boundaries based on coords
    const active = user.role === 'PASSENGER' ? activeRide : activeDriverRide;
    
    let pickLat = pickup.lat, pickLng = pickup.lng;
    let dropLat = destination.lat, dropLng = destination.lng;
    let carLat = null, carLng = null;

    if (active) {
      pickLat = active.pickup.latitude;
      pickLng = active.pickup.longitude;
      dropLat = active.destination.latitude;
      dropLng = active.destination.longitude;
      
      if (user.role === 'PASSENGER' && driverLocation) {
        carLat = driverLocation.latitude;
        carLng = driverLocation.longitude;
      } else if (user.role === 'DRIVER' && driverSimCoords) {
        carLat = driverSimCoords.latitude;
        carLng = driverSimCoords.longitude;
      }
    }

    // Standard bounding box projection mapping to 0-100% SVG coordinates
    const minLat = Math.min(pickLat, dropLat, carLat || pickLat) - 0.015;
    const maxLat = Math.max(pickLat, dropLat, carLat || pickLat) + 0.015;
    const minLng = Math.min(pickLng, dropLng, carLng || pickLng) - 0.015;
    const maxLng = Math.max(pickLng, dropLng, carLng || pickLng) + 0.015;

    const latRange = maxLat - minLat || 0.015;
    const lngRange = maxLng - minLng || 0.015;

    const getX = (lng) => ((lng - minLng) / lngRange) * 80 + 10;
    const getY = (lat) => 100 - (((lat - minLat) / latRange) * 80 + 10); // Invert Y for cartesian coordinates

    const pX = getX(pickLng);
    const pY = getY(pickLat);
    const dX = getX(dropLng);
    const dY = getY(dropLat);
    
    let cX = null, cY = null;
    let distanceVal = null;
    let etaVal = null;

    if (carLat && carLng) {
      cX = getX(carLng);
      cY = getY(carLat);
      const targetLat = active && active.status === 'DRIVER_ARRIVING' ? pickLat : dropLat;
      const targetLng = active && active.status === 'DRIVER_ARRIVING' ? pickLng : dropLng;
      distanceVal = Math.sqrt(Math.pow(carLat - targetLat, 2) + Math.pow(carLng - targetLng, 2)) * 111.32; // km
      etaVal = Math.max(Math.ceil(distanceVal * 2), 1); // min
    }

    return (
      <div className="map-canvas" style={{ position: 'relative' }}>
        <div className="map-grid-overlay"></div>
        
        {/* Background Cyber City Road Grid */}
        <svg style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
          {/* Vertical streets */}
          <line x1="20%" y1="0" x2="20%" y2="100%" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
          <line x1="40%" y1="0" x2="40%" y2="100%" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
          <line x1="60%" y1="0" x2="60%" y2="100%" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
          <line x1="80%" y1="0" x2="80%" y2="100%" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
          
          {/* Horizontal streets */}
          <line x1="0" y1="20%" x2="100%" y2="20%" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
          <line x1="0" y1="40%" x2="100%" y2="40%" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
          <line x1="0" y1="60%" x2="100%" y2="60%" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
          <line x1="0" y1="80%" x2="100%" y2="80%" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
          
          {/* Route connector path */}
          <path 
            d={`M ${pX}% ${pY}% L ${dX}% ${dY}%`}
            fill="none" 
            stroke="var(--accent-purple)" 
            strokeWidth="3.5" 
            strokeDasharray="8,6" 
            opacity="0.65"
            style={{ filter: 'drop-shadow(0 0 4px var(--accent-purple))' }}
          />

          {/* Pickup Marker Tower */}
          <g transform={`translate(${pX}, ${pY})`}>
            <circle cx="0" cy="0" r="16" fill="rgba(34,197,94,0.12)" stroke="var(--accent-green)" strokeWidth="1">
              <animate attributeName="r" values="8;18;8" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="0" cy="0" r="7" fill="var(--accent-green)" style={{ filter: 'drop-shadow(0 0 6px var(--accent-green))' }} />
            <text x="12" y="4" fill="#fff" fontSize="10" fontWeight="bold" letterSpacing="0.5">PICKUP</text>
          </g>

          {/* Destination Marker Tower */}
          <g transform={`translate(${dX}, ${dY})`}>
            <circle cx="0" cy="0" r="16" fill="rgba(239,68,68,0.12)" stroke="var(--accent-red)" strokeWidth="1">
              <animate attributeName="r" values="8;18;8" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="0" cy="0" r="7" fill="var(--accent-red)" style={{ filter: 'drop-shadow(0 0 6px var(--accent-red))' }} />
            <text x="12" y="4" fill="#fff" fontSize="10" fontWeight="bold" letterSpacing="0.5">DESTINATION</text>
          </g>

          {/* Glowing Vector Car Marker */}
          {cX !== null && cY !== null && (
            <g transform={`translate(${cX}, ${cY})`}>
              <circle cx="0" cy="0" r="22" fill="rgba(0, 240, 255, 0.15)" stroke="var(--accent-cyan)" strokeWidth="1.5">
                <animate attributeName="r" values="16;25;16" dur="2s" repeatCount="indefinite" />
              </circle>
              {/* Styled Vector Car Icon */}
              <rect x="-8" y="-8" width="16" height="16" rx="4" fill="var(--accent-cyan)" style={{ filter: 'drop-shadow(0 0 10px var(--accent-cyan))' }} />
              <rect x="-4" y="-12" width="8" height="4" rx="1" fill="#fff" opacity="0.8" />
              <circle cx="-5" cy="10" r="3" fill="#000" />
              <circle cx="5" cy="10" r="3" fill="#000" />
              <text x="16" y="-6" fill="var(--accent-cyan)" fontSize="10" fontWeight="bold">PILOT CAR</text>
            </g>
          )}
        </svg>
        
        {/* Floating live metrics HUD */}
        <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', background: 'rgba(9,10,17,0.92)', padding: '0.85rem 1.25rem', borderRadius: '10px', border: '1px solid var(--glass-border)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.2rem' }}>GPS Grid Tracking System</div>
          <div>📍 <b>Pickup:</b> {pickLat.toFixed(5)}, {pickLng.toFixed(5)}</div>
          <div>🏁 <b>Destination:</b> {dropLat.toFixed(5)}, {dropLng.toFixed(5)}</div>
          {carLat && <div style={{ color: 'var(--accent-cyan)', fontWeight: 'bold', marginTop: '0.15rem' }}>🚗 <b>Driver Location:</b> {carLat.toFixed(5)}, {carLng.toFixed(5)}</div>}
        </div>

        {/* Floating Distance & ETA HUD */}
        {distanceVal !== null && (
          <div style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(9,10,17,0.92)', padding: '0.85rem 1.25rem', borderRadius: '10px', border: '1px solid var(--glass-border)', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ color: 'var(--accent-cyan)', fontSize: '0.75rem', fontWeight: 'bold' }}>📡 TRIP TELEMETRY</div>
            <div><b>Distance:</b> {distanceVal.toFixed(2)} km</div>
            <div><b>ETA:</b> <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{etaVal} mins</span></div>
          </div>
        )}
      </div>
    );
  };

  // --- RENDER SECTION ---
  if (!token) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', minHeight: '100vh' }}>
        <div className="glass-panel" style={{ maxWidth: '440px', width: '100%', margin: '0 auto', padding: '2.5rem' }}>
          
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div className="logo-icon" style={{ margin: '0 auto 1rem' }}></div>
            <h1 style={{ fontSize: '2rem', margin: '0.5rem 0' }}>RideGrid Platform</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Real-time Dispatch Monolith Portal</p>
          </div>

          <form onSubmit={handleAuthSubmit}>
            {isRegister && (
              <div className="input-group">
                <label>Full Name</label>
                <input 
                  type="text" required className="input-field" placeholder="Name"
                  value={authForm.name} onChange={e => setAuthForm({ ...authForm, name: e.target.value })} 
                />
              </div>
            )}

            <div className="input-group">
              <label>Email Address</label>
              <input 
                type="email" required className="input-field" placeholder="email@example.com"
                value={authForm.email} onChange={e => setAuthForm({ ...authForm, email: e.target.value })} 
              />
            </div>

            <div className="input-group">
              <label>Password</label>
              <input 
                type="password" required className="input-field" placeholder="••••••••"
                value={authForm.password} onChange={e => setAuthForm({ ...authForm, password: e.target.value })} 
              />
            </div>

            {isRegister && (
              <div className="input-group">
                <label>Platform Role</label>
                <select 
                  className="select-field"
                  value={authForm.role} onChange={e => setAuthForm({ ...authForm, role: e.target.value })}
                >
                  <option value="PASSENGER">Passenger</option>
                  <option value="DRIVER">Driver</option>
                </select>
              </div>
            )}

            {authError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid var(--accent-red)', padding: '0.75rem', borderRadius: '6px', margin: '1rem 0', color: 'var(--accent-red)', fontSize: '0.85rem' }}>
                {authError}
              </div>
            )}

            <button type="submit" className={isRegister ? 'btn-purple' : 'btn-cyan'} style={{ marginTop: '1rem' }}>
              {isRegister ? 'Register Account' : 'Secure Login'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {isRegister ? 'Already have an account? ' : "Don't have an account? "}
            </span>
            <button 
              type="button" 
              style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', fontWeight: '600', cursor: 'pointer' }}
              onClick={() => { setIsRegister(!isRegister); setAuthError(''); }}
            >
              {isRegister ? 'Sign In' : 'Sign Up'}
            </button>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header bar */}
      <header className="header">
        <div className="logo-container">
          <div className="logo-icon"></div>
          <span className="logo-text">RideGrid</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span className={`indicator-dot ${socketConnected ? 'indicator-dot-green' : ''}`} style={{ background: socketConnected ? '' : 'var(--accent-red)' }}></span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{socketConnected ? 'Real-Time Sync' : 'Reconnecting'}</span>
          </div>

          <div className="glass-panel" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', borderRadius: '10px' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{user.name}</div>
              <span className={`status-badge ${user.role === 'DRIVER' ? 'status-badge-purple' : 'status-badge-cyan'}`} style={{ padding: '2px 8px', fontSize: '0.65rem' }}>
                {user.role}
              </span>
            </div>
            <button 
              onClick={handleLogout}
              style={{ background: 'none', border: 'none', color: 'var(--accent-red)', fontWeight: 'bold', cursor: 'pointer', padding: '0.25rem' }}
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Main Passenger Dashboard */}
      {user.role === 'PASSENGER' && (
        <div className="dashboard-grid">
          {/* Left panel: Bookings */}
          <div className="glass-panel" style={{ padding: '2rem' }}>
            {!activeRide ? (
              <>
                <h2 style={{ marginBottom: '1.5rem' }}>Request a Ride</h2>
                
                {/* Preset Coordinate Selection */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>Quick Location Presets</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {COORD_PRESETS.map((preset, idx) => (
                      <button 
                        key={idx} type="button" className="btn-outline" style={{ padding: '0.6rem', fontSize: '0.8rem', textAlign: 'left' }}
                        onClick={() => applyPreset(preset)}
                      >
                        📍 {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="input-group">
                  <label>Pickup Spot</label>
                  <input 
                    type="text" className="input-field" placeholder="Enter pickup spot"
                    value={pickup.address} onChange={e => setPickup({ ...pickup, address: e.target.value })} 
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <input type="number" step="any" className="input-field" style={{ padding: '0.4rem', fontSize: '0.8rem' }} placeholder="Lat" value={pickup.lat} onChange={e => setPickup({ ...pickup, lat: parseFloat(e.target.value) || 0 })} />
                    <input type="number" step="any" className="input-field" style={{ padding: '0.4rem', fontSize: '0.8rem' }} placeholder="Lng" value={pickup.lng} onChange={e => setPickup({ ...pickup, lng: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>

                <div className="input-group">
                  <label>Destination Spot</label>
                  <input 
                    type="text" className="input-field" placeholder="Enter destination spot"
                    value={destination.address} onChange={e => setDestination({ ...destination, address: e.target.value })} 
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <input type="number" step="any" className="input-field" style={{ padding: '0.4rem', fontSize: '0.8rem' }} placeholder="Lat" value={destination.lat} onChange={e => setDestination({ ...destination, lat: parseFloat(e.target.value) || 0 })} />
                    <input type="number" step="any" className="input-field" style={{ padding: '0.4rem', fontSize: '0.8rem' }} placeholder="Lng" value={destination.lng} onChange={e => setDestination({ ...destination, lng: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>

                <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                  <label>Vehicle Class</label>
                  <div className="vehicle-selector-grid">
                    {['BIKE', 'AUTO', 'ECONOMY', 'PREMIUM'].map((type) => (
                      <div 
                        key={type} 
                        className={`vehicle-card ${vehicleType === type ? 'active' : ''}`}
                        onClick={() => { setVehicleType(type); setEstimate(null); }}
                      >
                        <div className="vehicle-name">{type}</div>
                        <div className="vehicle-price" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {type === 'BIKE' && '$0.50/km'}
                          {type === 'AUTO' && '$0.80/km'}
                          {type === 'ECONOMY' && '$1.00/km'}
                          {type === 'PREMIUM' && '$1.50/km'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {estimate && (
                  <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', background: 'rgba(0,240,255,0.02)', borderColor: 'rgba(0,240,255,0.1)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', textAlign: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Est. Price</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent-cyan)' }}>${estimate.fare.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Distance</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{estimate.distance.toFixed(1)} km</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Duration</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{estimate.duration} min</div>
                      </div>
                    </div>
                  </div>
                )}

                {!estimate ? (
                  <button 
                    onClick={handleGetEstimate} disabled={estimateLoading || !pickup.address || !destination.address}
                    className="btn-purple"
                  >
                    {estimateLoading ? 'Computing Details...' : 'Get Fare Estimate'}
                  </button>
                ) : (
                  <button 
                    onClick={handleBookRide}
                    className="btn-cyan"
                  >
                    Request Ride
                  </button>
                )}

                {/* Simulated Past Trips List */}
                <div style={{ marginTop: '2.5rem' }}>
                  <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '1rem', letterSpacing: '0.5px', fontWeight: 'bold' }}>Trip History Logs</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="glass-panel" style={{ padding: '0.85rem 1.25rem', background: 'rgba(255,255,255,0.01)', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: 'var(--glass-border)' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#fff' }}>Downtown Plaza ➔ International Airport</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.15rem' }}>Yesterday • Completed • PREMIUM</div>
                      </div>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 'bold', fontSize: '0.9rem' }}>$42.50</span>
                    </div>
                    <div className="glass-panel" style={{ padding: '0.85rem 1.25rem', background: 'rgba(255,255,255,0.01)', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: 'var(--glass-border)' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', color: '#fff' }}>Railway Station ➔ Tech Park Zone C</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.15rem' }}>July 24, 2026 • Completed • ECONOMY</div>
                      </div>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 'bold', fontSize: '0.9rem' }}>$15.20</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ marginBottom: '1rem' }}>Active Journey</h2>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Ride ID: {activeRide._id.slice(-6).toUpperCase()}</span>
                  <span className={`status-badge ${
                    activeRide.status === 'SEARCHING' ? 'status-badge-amber' : 
                    activeRide.status === 'IN_PROGRESS' ? 'status-badge-cyan' : 'status-badge-green'
                  }`}>
                    {activeRide.status}
                  </span>
                </div>

                {['SEARCHING', 'DRIVER_OFFERED'].includes(activeRide.status) && (
                  <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', border: '1px dashed var(--accent-purple)', background: 'rgba(192,132,252,0.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.85rem' }}>
                      <div className="logo-icon" style={{ animation: 'logo-glow 1.5s infinite alternate', width: '22px', height: '22px' }}></div>
                      <span style={{ fontWeight: 'bold', color: 'var(--accent-purple)', fontSize: '0.8rem', letterSpacing: '0.5px' }}>RADAR DISPATCH ENGAGED</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      <div className="animated-log-item">🛰️ Scanning radius step: 2.0km...</div>
                      <div className="animated-log-item">🔍 Querying Redis GEO spatial index...</div>
                      {activeRide.status === 'DRIVER_OFFERED' ? (
                        <div className="animated-log-item" style={{ color: 'var(--accent-cyan)' }}>📲 Offering trip to nearest qualified driver...</div>
                      ) : (
                        <div className="animated-log-item">⏳ Waiting for drivers to accept...</div>
                      )}
                    </div>
                  </div>
                )}

                <div className="timeline">
                  <div className="timeline-line"></div>
                  
                  <div className={`timeline-item ${activeRide.status === 'SEARCHING' ? 'active' : 'completed'}`}>
                    <div className="timeline-marker"><div className="timeline-marker-inner"></div></div>
                    <div className="timeline-content">
                      <span className="timeline-title">Booking Requested</span>
                      <span className="timeline-time">Searching for nearby drivers</span>
                    </div>
                  </div>

                  <div className={`timeline-item ${['DRIVER_OFFERED', 'DRIVER_ASSIGNED'].includes(activeRide.status) ? 'active' : ['DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED'].includes(activeRide.status) ? 'completed' : ''}`}>
                    <div className="timeline-marker"><div className="timeline-marker-inner"></div></div>
                    <div className="timeline-content">
                      <span className="timeline-title">Driver Assigned</span>
                      <span className="timeline-time">
                        {activeRide.driverId 
                          ? `${activeRide.driverId.name || 'Driver'} is assigned`
                          : 'Awaiting driver response'}
                      </span>
                    </div>
                  </div>

                  <div className={`timeline-item ${['DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(activeRide.status) ? 'active' : ['IN_PROGRESS', 'COMPLETED'].includes(activeRide.status) ? 'completed' : ''}`}>
                    <div className="timeline-marker"><div className="timeline-marker-inner"></div></div>
                    <div className="timeline-content">
                      <span className="timeline-title">Driver Arriving</span>
                      <span className="timeline-time">Driver is en route to pickup</span>
                    </div>
                  </div>

                  <div className={`timeline-item ${activeRide.status === 'IN_PROGRESS' ? 'active' : activeRide.status === 'COMPLETED' ? 'completed' : ''}`}>
                    <div className="timeline-marker"><div className="timeline-marker-inner"></div></div>
                    <div className="timeline-content">
                      <span className="timeline-title">Trip In Progress</span>
                      <span className="timeline-time">Heading to destination</span>
                    </div>
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Receipt Overview:</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span>Base Fare:</span>
                    <span style={{ fontWeight: 'bold' }}>${activeRide.fare.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Vehicle Class:</span>
                    <span style={{ fontWeight: 'bold', color: 'var(--accent-cyan)' }}>{activeRide.vehicleType}</span>
                  </div>
                </div>

                {['REQUESTED', 'SEARCHING', 'DRIVER_OFFERED', 'DRIVER_ASSIGNED'].includes(activeRide.status) && (
                  <button 
                    onClick={() => handleCancelRide(activeRide._id)}
                    className="btn-outline" style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
                  >
                    Cancel Booking
                  </button>
                )}
              </>
            )}
          </div>

          {/* Right panel: Map */}
          <div>
            {renderMapVisual()}
          </div>
        </div>
      )}

      {/* Main Driver Dashboard */}
      {user.role === 'DRIVER' && (
        <div className="dashboard-grid">
          
          {/* Left panel: Driver controls */}
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <h2 style={{ marginBottom: '1.5rem' }}>Driver Control Station</h2>

            {/* Vehicle Registration */}
            {!vehicle ? (
              <form onSubmit={handleRegisterVehicle}>
                <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase' }}>Link Your Vehicle</h3>
                
                <div className="input-group">
                  <label>Model / Brand</label>
                  <input 
                    type="text" required className="input-field" placeholder="e.g. Tesla Model 3"
                    value={vehicleForm.model} onChange={e => setVehicleForm({ ...vehicleForm, model: e.target.value })}
                  />
                </div>

                <div className="input-group">
                  <label>License Plate</label>
                  <input 
                    type="text" required className="input-field" placeholder="e.g. RG-99-DISPATCH"
                    value={vehicleForm.licensePlate} onChange={e => setVehicleForm({ ...vehicleForm, licensePlate: e.target.value })}
                  />
                </div>

                <div className="input-group">
                  <label>Color</label>
                  <input 
                    type="text" required className="input-field" placeholder="e.g. Midnight Black"
                    value={vehicleForm.color} onChange={e => setVehicleForm({ ...vehicleForm, color: e.target.value })}
                  />
                </div>

                <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                  <label>Vehicle Class</label>
                  <select 
                    className="select-field"
                    value={vehicleForm.type} onChange={e => setVehicleForm({ ...vehicleForm, type: e.target.value })}
                  >
                    <option value="BIKE">Bike</option>
                    <option value="AUTO">Auto</option>
                    <option value="ECONOMY">Economy</option>
                    <option value="PREMIUM">Premium</option>
                  </select>
                </div>

                <button type="submit" className="btn-cyan">Register Vehicle</button>
              </form>
            ) : (
              <>
                {/* Driver Earnings & Trip Analytics Dashboard */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '2rem' }}>
                  <div className="glass-panel" style={{ padding: '0.85rem 0.5rem', textAlign: 'center', background: 'rgba(34,197,94,0.02)', borderColor: 'rgba(34,197,94,0.1)' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Earnings</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-green)', marginTop: '0.2rem' }}>$182.40</div>
                  </div>
                  <div className="glass-panel" style={{ padding: '0.85rem 0.5rem', textAlign: 'center', background: 'rgba(0,240,255,0.02)', borderColor: 'rgba(0,240,255,0.1)' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Completed</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-cyan)', marginTop: '0.2rem' }}>8 Trips</div>
                  </div>
                  <div className="glass-panel" style={{ padding: '0.85rem 0.5rem', textAlign: 'center', background: 'rgba(192,132,252,0.02)', borderColor: 'rgba(192,132,252,0.1)' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Rating</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-purple)', marginTop: '0.2rem' }}>4.92 ★</div>
                  </div>
                </div>

                {/* Active Availability Management */}
                <div style={{ marginBottom: '2rem' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.75rem', fontWeight: '600' }}>Presence Status</label>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                    {['OFFLINE', 'ONLINE', 'AVAILABLE'].map((state) => (
                      <button
                        key={state} type="button"
                        className={`btn-outline ${availability === state ? 'active' : ''}`}
                        style={{ 
                          padding: '0.6rem 0.25rem', 
                          fontSize: '0.75rem',
                          borderColor: availability === state ? (state === 'AVAILABLE' ? 'var(--accent-green)' : 'var(--accent-purple)') : '',
                          background: availability === state ? (state === 'AVAILABLE' ? 'rgba(34,197,94,0.1)' : 'rgba(192,132,252,0.1)') : ''
                        }}
                        onClick={() => handleAvailabilityToggle(state)}
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </div>

                {/* If Not Active Ride: display incoming searching requests */}
                {!activeDriverRide ? (
                  <div>
                    <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Available Ride Requests</h3>
                    
                    {incomingOffer ? (
                      <div className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(192, 132, 252, 0.08)', borderColor: 'var(--accent-purple)', animation: 'pulse 2.5s infinite' }}>
                        <h3 style={{ fontSize: '1.1rem', color: 'var(--accent-purple)', marginBottom: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          ⚡ INCOMING RIDE OFFER
                        </h3>
                        
                        <div style={{ fontSize: '0.85rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                          <div style={{ marginBottom: '0.4rem' }}><b>Pickup:</b> {incomingOffer.pickup.address}</div>
                          <div style={{ marginBottom: '0.4rem' }}><b>Destination:</b> {incomingOffer.destination.address}</div>
                          <div style={{ marginBottom: '0.4rem' }}><b>Fare Estimate:</b> <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>${incomingOffer.fare.toFixed(2)}</span></div>
                          <div><b>Class:</b> <span className="status-badge status-badge-cyan">{incomingOffer.vehicleType || 'ECONOMY'}</span></div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <button 
                            onClick={() => handleAcceptRideOffer(incomingOffer.rideId)}
                            className="btn-cyan" style={{ flex: 1, padding: '0.6rem', fontSize: '0.85rem' }}
                          >
                            Accept Offer
                          </button>
                          <button 
                            onClick={() => handleRejectRideOffer(incomingOffer.rideId)}
                            className="btn-outline" style={{ flex: 1, padding: '0.6rem', fontSize: '0.85rem', borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
                          >
                            Reject Offer
                          </button>
                        </div>
                      </div>
                    ) : availability !== 'AVAILABLE' ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>
                        Go ONLINE and set state to <b>AVAILABLE</b> to receive incoming ride dispatch offers.
                      </p>
                    ) : searchingRides.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' }}>
                        Awaiting ride dispatches. Passive listing active...
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {searchingRides.map((ride) => (
                          <div key={ride._id} className="glass-panel" style={{ padding: '1rem', background: 'rgba(255,255,255,0.01)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontWeight: 'bold' }}>{ride.vehicleType}</span>
                              <span style={{ fontSize: '0.95rem', fontWeight: 'bold', color: 'var(--accent-green)' }}>${ride.fare.toFixed(2)}</span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                              <div><b>From:</b> {ride.pickup.address}</div>
                              <div><b>To:</b> {ride.destination.address}</div>
                            </div>
                            <button 
                              onClick={() => handleAcceptRideOffer(ride._id)}
                              className="btn-cyan" style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                            >
                              Accept Ride Offer
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Active Ride Console */
                  <div>
                    <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>Active Trip Management</h3>
                    
                    <div style={{ fontSize: '0.85rem', marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
                      <div style={{ marginBottom: '0.5rem' }}><b>Passenger Name:</b> {activeDriverRide.passengerId?.name || 'A Passenger'}</div>
                      <div style={{ marginBottom: '0.5rem' }}><b>Pickup Address:</b> {activeDriverRide.pickup.address}</div>
                      <div style={{ marginBottom: '0.5rem' }}><b>Destination Address:</b> {activeDriverRide.destination.address}</div>
                      <div style={{ marginBottom: '0.5rem' }}><b>Estimated Earnings:</b> <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>${activeDriverRide.fare.toFixed(2)}</span></div>
                      <div><b>Status:</b> <span className="status-badge status-badge-cyan">{activeDriverRide.status}</span></div>
                    </div>

                    {/* Progress controller buttons */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {activeDriverRide.status === 'DRIVER_ASSIGNED' && (
                        <button 
                          onClick={() => transitionRideStatus(activeDriverRide._id, 'DRIVER_ARRIVING')}
                          className="btn-purple"
                        >
                          Arrive to Passenger
                        </button>
                      )}

                      {activeDriverRide.status === 'DRIVER_ARRIVING' && (
                        <>
                          <button 
                            onClick={() => transitionRideStatus(activeDriverRide._id, 'DRIVER_ARRIVED')}
                            className="btn-purple"
                          >
                            Arrived at Pickup Location
                          </button>
                          <button 
                            onClick={() => setIsSimulating(!isSimulating)}
                            className="btn-outline" style={{ borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }}
                          >
                            {isSimulating ? 'Pause GPS Simulation' : 'Auto-Simulate GPS Approach'}
                          </button>
                        </>
                      )}

                      {activeDriverRide.status === 'DRIVER_ARRIVED' && (
                        <button 
                          onClick={() => transitionRideStatus(activeDriverRide._id, 'IN_PROGRESS')}
                          className="btn-cyan"
                        >
                          Start Passenger Trip
                        </button>
                      )}

                      {activeDriverRide.status === 'IN_PROGRESS' && (
                        <>
                          <button 
                            onClick={() => transitionRideStatus(activeDriverRide._id, 'COMPLETED')}
                            className="btn-green" style={{ background: 'linear-gradient(135deg, var(--accent-green), #15803d)', border: 'none', color: '#fff', padding: '1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                          >
                            Complete Journey
                          </button>
                          <button 
                            onClick={() => setIsSimulating(!isSimulating)}
                            className="btn-outline" style={{ borderColor: 'var(--accent-cyan)', color: 'var(--accent-cyan)' }}
                          >
                            {isSimulating ? 'Pause GPS Simulation' : 'Auto-Simulate Journey'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right panel: Active Map plotting */}
          <div>
            {renderMapVisual()}
          </div>

        </div>
      )}
    </div>
  );
}

export default App;
