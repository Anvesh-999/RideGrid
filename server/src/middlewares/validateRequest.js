import { validationResult } from 'express-validator';
import { BadRequestError } from '../utils/errors.js';

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg
    }));
    
    const badRequestError = new BadRequestError('Validation failed', 'VALIDATION_FAILED');
    badRequestError.errors = errorMessages; // Attach detailed error array
    return next(badRequestError);
  }
  next();
};

export default validateRequest;
