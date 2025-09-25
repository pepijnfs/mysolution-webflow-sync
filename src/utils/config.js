import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Initialize dotenv
dotenv.config();

// Helper function to get directory name in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

// Validate required environment variables
const requiredEnvVars = [
  // Mysolution API
  'MYSOLUTION_API_URL',
  'MYSOLUTION_CLIENT_ID',
  'MYSOLUTION_CLIENT_SECRET',
  
  // Webflow API
  'WEBFLOW_API_TOKEN',
  'WEBFLOW_SITE_ID',
  'WEBFLOW_JOBS_COLLECTION_ID',
  'WEBFLOW_CANDIDATES_COLLECTION_ID',
  'WEBFLOW_SECTORS_COLLECTION_ID',
];

// Check for missing required environment variables
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Error: Missing required environment variables:');
  missingEnvVars.forEach(varName => {
    console.error(`- ${varName}`);
  });
  console.error('\nPlease check your .env file or environment configuration.');
  console.error('You can use .env.example as a template.');
  process.exit(1);
}

// Config object with all environment variables
const config = {
  // Core application settings
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    isDev: (process.env.NODE_ENV || 'development') === 'development',
    isProd: process.env.NODE_ENV === 'production',
    adminApiKey: process.env.ADMIN_API_KEY || 'development-api-key',
  },
  
  // Mysolution API settings
  mysolution: {
    apiUrl: process.env.MYSOLUTION_API_URL,
    clientId: process.env.MYSOLUTION_CLIENT_ID,
    clientSecret: process.env.MYSOLUTION_CLIENT_SECRET,
    timeout: parseInt(process.env.MYSOLUTION_API_TIMEOUT || '30000', 10),
    retryAttempts: parseInt(process.env.MYSOLUTION_API_RETRY_ATTEMPTS || '3', 10),
    retryDelay: parseInt(process.env.MYSOLUTION_API_RETRY_DELAY || '1000', 10),
  },
  
  // Webflow API settings
  webflow: {
    apiKey: process.env.WEBFLOW_API_TOKEN,
    siteId: process.env.WEBFLOW_SITE_ID,
    jobsCollectionId: process.env.WEBFLOW_JOBS_COLLECTION_ID,
    candidatesCollectionId: process.env.WEBFLOW_CANDIDATES_COLLECTION_ID,
    sectorsCollectionId: process.env.WEBFLOW_SECTORS_COLLECTION_ID,
    timeout: parseInt(process.env.WEBFLOW_API_TIMEOUT || '30000', 10),
    rateLimit: parseInt(process.env.WEBFLOW_RATE_LIMIT || '60', 10), // Requests per minute
    autoPublish: process.env.WEBFLOW_AUTO_PUBLISH === 'true', // Whether to automatically publish changes
  },
  
  // Sync settings
  sync: {
    interval: parseInt(process.env.SYNC_INTERVAL || '60000', 10), // Default: 1 minute
    get syncIntervalMinutes() {
      return Math.ceil(this.interval / 60000); // Convert milliseconds to minutes
    },
    maxBatchSize: parseInt(process.env.SYNC_MAX_BATCH_SIZE || '100', 10),
    concurrency: parseInt(process.env.SYNC_CONCURRENCY || '5', 10),
    retryFailedAfter: parseInt(process.env.SYNC_RETRY_FAILED_AFTER || '1800000', 10), // 30 minutes
    enableScheduledSync: process.env.ENABLE_SCHEDULED_SYNC === 'true', // Whether to enable scheduled auto-sync
  },
  
  // Logging settings
  logging: {
    level: process.env.LOG_LEVEL || 'warn',
    file: process.env.LOG_FILE || path.join(rootDir, 'logs/app.log'),
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '7', 10),
    console: process.env.LOG_CONSOLE !== 'false',
    datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD',
    zippedArchive: process.env.LOG_ZIPPED_ARCHIVE === 'true',
    // HTTP Request logging settings
    httpRequestLogging: process.env.HTTP_REQUEST_LOGGING !== 'false', 
    httpLogLevel: process.env.HTTP_LOG_LEVEL || 'warn',
    httpLogFormat: process.env.HTTP_LOG_FORMAT || 'combined',
    // Skip certain routes from logging
    skipRoutes: (process.env.LOG_SKIP_ROUTES || '/health,/static,/api/admin/jobs/count,/api/admin/sync/status').split(','),
    // Request ID settings
    requestIdHeader: process.env.REQUEST_ID_HEADER || 'x-request-id',
    generateRequestId: process.env.GENERATE_REQUEST_ID !== 'false',
    // Minimal console mode: drastically reduce console noise (file logs remain structured)
    minimalConsole: process.env.MINIMAL_LOG_CONSOLE === 'true',
  },
  
  // Get a nested config value using dot notation
  get(path, defaultValue = undefined) {
    const parts = path.split('.');
    let current = this;
    
    for (const part of parts) {
      if (current[part] === undefined) {
        return defaultValue;
      }
      current = current[part];
    }
    
    return current;
  }
};

export default config; 