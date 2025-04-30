import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { EventEmitter } from 'events';
import { logger } from './utils/logger.js';
import config from './utils/config.js';
import { jobsSync, incrementalJobsSync } from './services/jobsSync.js';
import { processNewCandidate } from './services/candidatesSync.js';
import jobsRoutes from './routes/jobs.js';
import candidatesRoutes from './routes/candidates.js';
import webhookRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import apiRoutes from './routes/api.js';
import webflowAPI from './api/webflow.js';
import mysolutionAPI from './api/mysolution.js';
import syncStateStore from './utils/syncStateStore.js';

// Helper for __dirname in ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Express app
const app = express();
const PORT = config.app.port;

// Create global event emitter for real-time updates
const eventBus = new EventEmitter();
global.eventBus = eventBus; // Make it accessible globally

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Add request logging middleware for debugging form submissions
app.use((req, res, next) => {
  if (req.path.includes('/api/webhooks/webflow')) {
    logger.debug('Incoming webhook request:', {
      path: req.path,
      method: req.method,
      contentType: req.headers['content-type'],
      body: req.body,
      params: req.params,
      query: req.query
    });
  }
  next();
});

// Request ID and logging middleware
app.use(logger.middleware.requestId);

// HTTP request logging (if enabled)
if (config.logging.httpRequestLogging) {
  app.use(logger.middleware.request);
}

// Custom log transport that emits events for real-time logging
logger.addRealTimeTransport(function(info) {
  const { level, message, timestamp, metadata } = info;
  const logEvent = { 
    timestamp, 
    level, 
    message,
    metadata
  };
  
  // Emit the log event for real-time streaming
  eventBus.emit('log', logEvent);
  
  // Detect sync completion events and emit them
  if (message.includes('sync completed') || message.includes('Published to Webflow')) {
    eventBus.emit('sync-completed');
  }
});

// API Routes
app.use('/api/jobs', jobsRoutes);
app.use('/api/candidates', candidatesRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Server-Sent Events endpoint for real-time updates
app.get('/api/events', (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial message
  res.write(`event: log\ndata: {"message": "Connected to event stream", "level": "info"}\n\n`);
  
  // Create event listeners
  const logListener = (logData) => {
    const safeLogData = {
      timestamp: logData.timestamp,
      level: logData.level,
      message: logData.message,
      // Only include safe metadata to avoid exposing sensitive info
      requestId: logData.metadata?.requestId,
      syncId: logData.metadata?.syncId
    };
    res.write(`event: log\ndata: ${JSON.stringify(safeLogData)}\n\n`);
  };
  
  const syncCompletedListener = async () => {
    try {
      // Fetch updated sync state
      const syncState = syncStateStore.getSyncState();
      
      // Fetch job counts
      const webflowJobsResponse = await webflowAPI.getJobs().catch(() => ({ items: [] }));
      const webflowJobCount = webflowJobsResponse.items ? webflowJobsResponse.items.length : 0;
      const mysolutionJobs = await mysolutionAPI.getJobs().catch(() => []);
      const mysolutionJobCount = mysolutionJobs.length;
      
      // Create sync update event
      const syncData = {
        lastSync: syncState.lastSync,
        jobCounts: {
          mysolution: mysolutionJobCount,
          webflow: webflowJobCount
        },
        publishTime: syncState.lastPublishTime
      };
      
      // Send sync update event
      res.write(`event: sync\ndata: ${JSON.stringify(syncData)}\n\n`);
    } catch (error) {
      logger.error('Error sending sync update', { error: error.message });
    }
  };

  // Register event listeners
  eventBus.on('log', logListener);
  eventBus.on('sync-completed', syncCompletedListener);
  
  // Handle client disconnect
  req.on('close', () => {
    // Remove event listeners
    eventBus.removeListener('log', logListener);
    eventBus.removeListener('sync-completed', syncCompletedListener);
    res.end();
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Service is running',
    timestamp: new Date().toISOString(),
    environment: config.app.nodeEnv
  });
});

// Serve the HTML page for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error logging middleware
app.use(logger.middleware.error);

// Default error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { error: err, stack: err.stack }, req);
  
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
    requestId: req.headers[config.logging.requestIdHeader]
  });
});

// Schedule periodic sync with configurable interval
const syncIntervalMinutes = Math.ceil(config.sync.interval / 60000);
const incrementalSyncCronPattern = `*/${syncIntervalMinutes} * * * *`;
const fullSyncCronPattern = `0 7 * * *`; // Daily at 7 AM
logger.info(`Setting up incremental job sync schedule: ${incrementalSyncCronPattern} (${config.sync.enableScheduledSync ? 'enabled' : 'disabled'})`);
logger.info(`Setting up daily full job sync schedule: ${fullSyncCronPattern} (${config.sync.enableScheduledSync ? 'enabled' : 'disabled'})`);

// Create the scheduler for incremental syncs
const scheduledIncrementalJobsSync = cron.schedule(incrementalSyncCronPattern, async () => {
  // Skip if exactly 7 AM as full sync will run at that time
  const now = new Date();
  if (now.getHours() === 7 && now.getMinutes() === 0) {
    logger.info('Skipping incremental sync at 7 AM as full sync will run');
    return;
  }
  
  const syncId = `incremental-sync-${Date.now()}`;
  logger.info('Running scheduled incremental jobs sync', { syncId });
  
  try {
    await incrementalJobsSync();
    logger.info('Incremental jobs sync completed successfully', { syncId });
  } catch (error) {
    logger.error('Error in scheduled incremental jobs sync', { syncId, error: error.message, stack: error.stack });
  }
}, {
  scheduled: config.sync.enableScheduledSync // Only start if enabled in config
});

// Create the scheduler for full sync at 7 AM daily
const scheduledFullJobsSync = cron.schedule(fullSyncCronPattern, async () => {
  const syncId = `full-sync-${Date.now()}`;
  logger.info('Running scheduled FULL jobs sync (daily 7 AM process)', { syncId });
  
  try {
    await jobsSync(); // Run full sync
    logger.info('Full jobs sync completed successfully', { syncId });
  } catch (error) {
    logger.error('Error in scheduled full jobs sync', { syncId, error: error.message, stack: error.stack });
  }
}, {
  scheduled: config.sync.enableScheduledSync // Only start if enabled in config
});

// Make schedulers globally accessible so API endpoints can control them
global.scheduledJobsSync = scheduledIncrementalJobsSync; // Keep existing API references working
global.scheduledFullJobsSync = scheduledFullJobsSync;

// Log whether scheduled sync is enabled
if (config.sync.enableScheduledSync) {
  logger.info(`Scheduled sync is ENABLED - incremental sync every ${syncIntervalMinutes} minute(s) with a full sync daily at 7 AM`);
} else {
  logger.info('Scheduled sync is DISABLED - use the dashboard to trigger syncs manually');
}

// Add an endpoint to reset sync state and trigger a full sync
app.post('/api/admin/reset-sync', (req, res) => {
  if (req.headers['x-api-key'] !== config.app.adminApiKey) {
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized' 
    });
  }
  
  try {
    const resetId = `reset-sync-${Date.now()}`;
    logger.info('Resetting sync state and triggering full sync', { resetId });
    
    // Reset sync state handled within the sync function
    jobsSync()
      .then(result => {
        logger.info('Full sync after reset completed successfully', { resetId, result });
      })
      .catch(error => {
        logger.error('Error during full sync after reset', { resetId, error: error.message, stack: error.stack });
      });
    
    res.status(202).json({ 
      success: true, 
      message: 'Sync reset initiated. Full sync in progress.' 
    });
  } catch (error) {
    logger.error('Error handling reset sync request', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      success: false, 
      error: 'Error initiating sync reset' 
    });
  }
});

/**
 * Smart sync function that decides whether to do a full or incremental sync
 * based on the current state of jobs in Webflow
 */
async function runSmartSync() {
  const syncId = `smart-sync-${Date.now()}`;
  
  try {
    // Check jobs in Webflow
    const webflowJobsResponse = await webflowAPI.getJobs();
    const webflowJobs = webflowJobsResponse.items || [];
    const webflowJobCount = webflowJobs.length;
    
    // Check jobs in Mysolution (just count them)
    const mysolutionJobs = await mysolutionAPI.getJobs();
    const mysolutionJobCount = mysolutionJobs.length;
    
    // Decide whether to do a full or incremental sync
    const jobRatio = webflowJobCount / Math.max(mysolutionJobCount, 1);
    
    if (webflowJobCount === 0 || jobRatio < 0.5) {
      // If Webflow has no jobs or less than half the jobs in Mysolution, do a full sync
      logger.info(`SMART SYNC: Webflow has ${webflowJobCount} jobs, Mysolution has ${mysolutionJobCount} jobs. Running full sync.`, { syncId });
      return await jobsSync();
    } else {
      // Otherwise, do an incremental sync
      logger.info(`SMART SYNC: Webflow has ${webflowJobCount} jobs, Mysolution has ${mysolutionJobCount} jobs. Running incremental sync.`, { syncId });
      return await incrementalJobsSync();
    }
  } catch (error) {
    logger.error('Error during smart sync determination', { syncId, error: error.message, stack: error.stack });
    // Fall back to incremental sync on error
    logger.info('Falling back to incremental sync due to error', { syncId });
    return await incrementalJobsSync();
  }
}

// Start server
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT} in ${config.app.nodeEnv} mode`);
  logger.info(`Dashboard available at http://localhost:${PORT}`);
  
  // No longer running automatic sync on startup
  // Users can trigger syncs manually through the dashboard UI
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  scheduledIncrementalJobsSync.stop();
  scheduledFullJobsSync.stop();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, stack: reason?.stack });
});

export default app; 