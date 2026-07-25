import jwt from 'jsonwebtoken';
import User from '../users/user.model.js';
import { ConflictError, UnauthorizedError } from '../../utils/errors.js';

// Access Secrets from env
const getAccessSecret = () => process.env.JWT_ACCESS_SECRET || 'fallback_access_secret_123';
const getRefreshSecret = () => process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_123';
const getAccessExpiry = () => process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const getRefreshExpiry = () => process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Generate Access and Refresh JWTs for a user
 */
export const generateTokens = (user) => {
  const payload = {
    userId: user._id,
    email: user.email,
    role: user.role
  };

  const accessToken = jwt.sign(payload, getAccessSecret(), {
    expiresIn: getAccessExpiry()
  });

  const refreshToken = jwt.sign({ userId: user._id }, getRefreshSecret(), {
    expiresIn: getRefreshExpiry()
  });

  return { accessToken, refreshToken };
};

/**
 * Register a new user
 */
export const register = async (userData) => {
  const { name, email, password, role } = userData;

  // Check if email already in use
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ConflictError('Email is already registered', 'EMAIL_ALREADY_EXISTS');
  }

  // Create user
  const user = new User({
    name,
    email,
    password,
    role: role || 'PASSENGER'
  });

  await user.save();

  // Generate initial tokens
  const tokens = generateTokens(user);

  // Store refresh token
  user.refreshToken = tokens.refreshToken;
  await user.save();

  // Format user output
  const userJson = user.toJSON();
  delete userJson.password;
  delete userJson.refreshToken;

  return {
    user: userJson,
    ...tokens
  };
};

/**
 * Login user and generate tokens
 */
export const login = async (email, password) => {
  // Find user by email and explicitly include password field
  const user = await User.findOne({ email }).select('+password');
  
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Verify password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Generate tokens
  const tokens = generateTokens(user);

  // Store refresh token
  user.refreshToken = tokens.refreshToken;
  await user.save();

  // Format user output
  const userJson = user.toJSON();
  delete userJson.password;
  delete userJson.refreshToken;

  return {
    user: userJson,
    ...tokens
  };
};
