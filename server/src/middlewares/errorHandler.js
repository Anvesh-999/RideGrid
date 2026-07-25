import logger from '../utils/logger.js';

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  const isOperational = err.isOperational || false;

  const errorResponse = {
    success: false,
    error: {
      code: errorCode,
      message: err.message || 'An unexpected error occurred.'
    }
  };

  // Include validation details if any (e.g. from express-validator)
  if (err.errors) {
    errorResponse.error.details = err.errors;
  }

  // Log the error
  const logMeta = {
    requestId: req.id,
    path: req.path,
    method: req.method,
    statusCode,
    errorCode,
    isOperational
  };

  if (statusCode >= 500) {
    // Log unexpected exceptions as errors with full stack trace
    logger.error(`[Server Error] ${err.message}`, { ...logMeta, stack: err.stack });
  } else {
    // Log client/operational errors as warnings
    logger.warn(`[Client Error] ${err.message}`, logMeta);
  }

  res.status(statusCode).json(errorResponse);
};

export default errorHandler;
