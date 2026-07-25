import mongoose from 'mongoose';

const DriverProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  rating: {
    type: Number,
    default: 5.0,
    min: 1,
    max: 5
  },
  ratingCount: {
    type: Number,
    default: 0
  },
  onlineStatus: {
    type: String,
    enum: ['OFFLINE', 'ONLINE'],
    default: 'OFFLINE'
  },
  availabilityStatus: {
    type: String,
    enum: ['OFFLINE', 'AVAILABLE', 'RESERVED', 'ON_TRIP'],
    default: 'OFFLINE'
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    default: null
  },
  todayEarnings: {
    type: Number,
    default: 0
  },
  weeklyEarnings: {
    type: Number,
    default: 0
  },
  totalTrips: {
    type: Number,
    default: 0
  },
  acceptanceRate: {
    type: Number,
    default: 100,
    min: 0,
    max: 100
  },
  cancellationRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  }
}, {
  timestamps: true
});

const DriverProfile = mongoose.model('DriverProfile', DriverProfileSchema);

export default DriverProfile;
