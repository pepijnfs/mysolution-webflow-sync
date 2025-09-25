import winston from 'winston';
import 'winston-daily-rotate-file';
import expressWinston from 'express-winston';
import { v4 as uuidv4 } from 'uuid';
import config from './config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Ensure log directory exists (but only in development mode)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.dirname(config.logging.file);
const isProd = config.app.isProd || process.env.VERCEL || process.env.VERCEL_ENV;

// Only try to create logs directory in development
if (!isProd && !fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (error) {
    console.warn(`Warning: Could not create logs directory: ${error.message}`);
  }
}

// Store request IDs by context
const requestIds = new Map();

// Create a namespace for the logger
class LoggerNamespace {
  constructor(options = {}) {
    this.defaultMeta = options.defaultMeta || {};
  }

  setRequestId(req) {
    let requestId;
    
    // Check if request ID is in the headers
    const requestIdHeader = config.logging.requestIdHeader;
    if (req.headers && req.headers[requestIdHeader]) {
      requestId = req.headers[requestIdHeader];
    } 
    // Generate a new request ID if needed
    else if (config.logging.generateRequestId) {
      requestId = uuidv4();
      if (req.headers) {
        req.headers[requestIdHeader] = requestId;
      }
    }

    if (requestId) {
      requestIds.set(req, requestId);
      return requestId;
    }
    
    return null;
  }
  
  getRequestId(req) {
    return requestIds.get(req);
  }
  
  clearRequestId(req) {
    requestIds.delete(req);
  }

  // Create a child logger with additional metadata
  child(options = {}) {
    const childMeta = { ...this.defaultMeta, ...options };
    return new LoggerNamespace({ defaultMeta: childMeta });
  }
}

// Create the namespace
const namespace = new LoggerNamespace({
  defaultMeta: { service: 'mysolution-job-sync' }
});

// Custom format for log entries
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(info => {
    const { timestamp, level, message, metadata = {}, service, stack } = info;
    
    // Convert timestamp to ISO string if it's not already
    const formattedTimestamp = timestamp instanceof Date
      ? timestamp.toISOString()
      : timestamp;
      
    // Format the metadata for display
    const metaString = Object.keys(metadata).length > 0
      ? `, ${JSON.stringify(metadata)}`
      : '';
      
    // Include stack trace for errors
    const stackTrace = stack ? `\n${stack}` : '';
    
    return `${formattedTimestamp} [${level.toUpperCase()}] ${message}${metaString}${stackTrace}`;
  })
);

// Create a JSON format for structured logging
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

// Create transports array, starting with console
const transports = [];

// Add console transport if enabled
if (config.logging.console) {
  transports.push(new winston.transports.Console({
    level: config.logging.minimalConsole ? 'error' : config.logging.level,
    format: winston.format.combine(
      winston.format.colorize(),
      config.logging.minimalConsole ? winston.format.simple() : customFormat
    )
  }));
}

// Only add file transports in development (not on Vercel)
if (!isProd && config.logging.file) {
  // Create file transport for daily rotation
  transports.push(new winston.transports.DailyRotateFile({
    filename: 'logs/%DATE%-app.log',
    datePattern: config.logging.datePattern,
    zippedArchive: config.logging.zippedArchive,
    maxSize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
    level: config.logging.level,
    format: jsonFormat
  }));

  // Error-specific file transport
  transports.push(new winston.transports.DailyRotateFile({
    filename: 'logs/%DATE%-error.log',
    datePattern: config.logging.datePattern,
    zippedArchive: config.logging.zippedArchive,
    maxSize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
    level: 'error',
    format: jsonFormat
  }));
}

// Custom transport for real-time logging
class RealTimeTransport extends winston.Transport {
  constructor(callback, opts) {
    super(opts);
    this.callback = callback;
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Call the callback function with the log info
    if (this.callback) {
      this.callback(info);
    }

    callback();
  }
}

// Create the winston logger instance
const winstonLogger = winston.createLogger({
  level: config.logging.level,
  defaultMeta: { service: 'mysolution-job-sync' },
  format: jsonFormat,
  transports: transports
});

// Express middleware for request logging
const requestLogger = expressWinston.logger({
  winstonInstance: winstonLogger,
  level: config.logging.httpLogLevel,
  meta: true,
  msg: 'HTTP {{req.method}} {{req.url}}',
  expressFormat: true,
  colorize: false,
  ignoreRoute: function (req, res) {
    // Skip logging for routes defined in config
    return config.logging.skipRoutes.some(path => req.url.startsWith(path));
  }
});

// Express middleware for error logging
const errorLogger = expressWinston.errorLogger({
  winstonInstance: winstonLogger,
  level: 'error',
  meta: true,
  msg: 'HTTP {{err.status || 500}} - {{err.message}} - {{req.method}} {{req.url}}',
  colorize: false,
});

// Middleware to add request ID
const requestIdMiddleware = (req, res, next) => {
  // Use existing request ID from header if available, or generate a new one
  let requestId = req.headers[config.logging.requestIdHeader];
  
  if (!requestId && config.logging.generateRequestId) {
    requestId = uuidv4();
    req.headers[config.logging.requestIdHeader] = requestId;
  }
  
  // Add the request ID to res.locals for use in templates, etc.
  res.locals.requestId = requestId;
  
  // Add a logger instance specific to this request
  if (requestId) {
    req.logger = winstonLogger.child({ requestId });
  } else {
    req.logger = winstonLogger;
  }
  
  next();
};

// Method to add real-time transport
const addRealTimeTransport = (callback) => {
  const realTimeTransport = new RealTimeTransport(callback, {
    level: 'info',
  });
  
  winstonLogger.add(realTimeTransport);
  return realTimeTransport;
};

// Method to remove a previously added real-time transport
const removeRealTimeTransport = (transportInstance) => {
  try {
    if (transportInstance) {
      winstonLogger.remove(transportInstance);
    }
  } catch (err) {
    // Swallow errors to avoid impacting runtime
  }
};

// Create properly exported logger with all functions
const loggerInstance = {
  error: (...args) => winstonLogger.error(...args),
  warn: (...args) => winstonLogger.warn(...args),
  info: (...args) => winstonLogger.info(...args),
  verbose: (...args) => winstonLogger.verbose(...args),
  debug: (...args) => winstonLogger.debug(...args),
  silly: (...args) => winstonLogger.silly(...args),
  log: (...args) => winstonLogger.log(...args),
  child: (...args) => winstonLogger.child(...args),
  
  middleware: {
    request: requestLogger,
    error: errorLogger,
    requestId: requestIdMiddleware
  },
  
  addRealTimeTransport,
  removeRealTimeTransport,
  
  // Add namespace methods for convenience
  setRequestId: (req) => namespace.setRequestId(req),
  getRequestId: (req) => namespace.getRequestId(req),
  clearRequestId: (req) => namespace.clearRequestId(req)
};

// Simple export
export const logger = loggerInstance; 