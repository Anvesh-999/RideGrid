import mongoose from 'mongoose';

const VehicleSchema = new mongoose.Schema({
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  make: {
    type: String,
    required: [true, 'Vehicle make is required']
  },
  model: {
    type: String,
    required: [true, 'Vehicle model is required']
  },
  licensePlate: {
    type: String,
    required: [true, 'License plate is required'],
    unique: true,
    trim: true,
    uppercase: true
  },
  type: {
    type: String,
    enum: ['BIKE', 'AUTO', 'ECONOMY', 'PREMIUM'],
    required: [true, 'Vehicle type must be BIKE, AUTO, ECONOMY, or PREMIUM']
  },
  capacity: {
    type: Number,
    required: [true, 'Vehicle capacity is required'],
    min: [1, 'Capacity must be at least 1']
  }
}, {
  timestamps: true
});

const Vehicle = mongoose.model('Vehicle', VehicleSchema);

export default Vehicle;
