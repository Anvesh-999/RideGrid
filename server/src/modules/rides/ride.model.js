import mongoose from 'mongoose';

const RideLocationSchema = new mongoose.Schema({
  address: {
    type: String,
    required: [true, 'Address is required']
  },
  latitude: {
    type: Number,
    required: [true, 'Latitude is required'],
    min: -90,
    max: 90
  },
  longitude: {
    type: Number,
    required: [true, 'Longitude is required'],
    min: -180,
    max: 180
  }
}, { _id: false });

const CancellationSchema = new mongoose.Schema({
  actor: {
    type: String,
    enum: ['PASSENGER', 'DRIVER', 'SYSTEM'],
    required: true
  },
  reason: {
    type: String,
    trim: true,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const RideSchema = new mongoose.Schema({
  passengerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  pickup: {
    type: RideLocationSchema,
    required: true
  },
  destination: {
    type: RideLocationSchema,
    required: true
  },
  vehicleType: {
    type: String,
    enum: ['BIKE', 'AUTO', 'ECONOMY', 'PREMIUM'],
    required: true
  },
  status: {
    type: String,
    enum: [
      'REQUESTED',
      'SEARCHING',
      'DRIVER_OFFERED',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_DRIVER_FOUND'
    ],
    default: 'REQUESTED'
  },
  fare: {
    type: Number,
    required: true
  },
  distance: {
    type: Number, // Estimated distance in km
    required: true
  },
  duration: {
    type: Number, // Estimated duration in minutes
    required: true
  },
  cancellation: {
    type: CancellationSchema,
    default: null
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  assignedAt: {
    type: Date
  },
  arrivedAt: {
    type: Date
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for common lookups
RideSchema.index({ passengerId: 1 });
RideSchema.index({ driverId: 1 });
RideSchema.index({ status: 1 });
RideSchema.index({ createdAt: -1 });

const Ride = mongoose.model('Ride', RideSchema);

export default Ride;
