import winston from 'winston';

const { combine, timestamp, json, colorize, printf, errors } = winston.format;

// Dev logging format
const devFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] ${level}: ${stack || message}${metaString}`;
});

// Configure transporter based on environment
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? json()
        : combine(colorize(), devFormat)
    })
  ]
});

export default logger;
