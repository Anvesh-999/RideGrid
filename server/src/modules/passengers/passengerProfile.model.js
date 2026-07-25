import mongoose from 'mongoose';

const SavedLocationSchema = new mongoose.Schema({
  label: {
    type: String,
    required: [true, 'Location label is required (e.g. Home, Work)'],
    trim: true
  },
  address: {
    type: String,
    required: [true, 'Location address is required']
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
}, { _id: true }); // Enable id for deleting/updating saved locations individually

const PassengerProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  phoneNumber: {
    type: String,
    trim: true,
    default: ''
  },
  savedLocations: {
    type: [SavedLocationSchema],
    default: []
  }
}, {
  timestamps: true
});

const PassengerProfile = mongoose.model('PassengerProfile', PassengerProfileSchema);

export default PassengerProfile;
