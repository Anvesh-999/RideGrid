import jwt from 'jsonwebtoken';
import { UnauthorizedError, ForbiddenError } from '../../utils/errors.js';

const getAccessSecret = () => process.env.JWT_ACCESS_SECRET || 'fallback_access_secret_123';

/**
 * Authenticate incoming requests by verifying the JWT access token in the Authorization header
 */
export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Access token is required.'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, getAccessSecret());
    req.user = decoded; // Attach user payload (userId, email, role) to request
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Access token has expired.', 'ACCESS_TOKEN_EXPIRED'));
    }
    return next(new UnauthorizedError('Invalid access token.'));
  }
};

/**
 * Authorize the authenticated user based on role comparison
 * @param {...string} allowedRoles - List of roles permitted to access the route
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication is required.'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError('Access forbidden: Insufficient permissions.'));
    }

    next();
  };
};
