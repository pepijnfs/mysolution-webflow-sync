import express from 'express';
import { logger } from '../utils/logger.js';
import publishingService from '../services/publishingService.js';
import webflowAPI from '../api/webflow.js';
import config from '../utils/config.js';
import mysolutionAPI from '../api/mysolution.js';
import syncStateStore from '../utils/syncStateStore.js';
import { incrementalJobsSync, jobsSync } from '../services/jobsSync.js';
import auth from '../utils/auth.js';
import { getDeploymentInfo } from '../utils/deploymentInfo.js';

const router = express.Router();

// Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
  // Check both headers and query parameters for API key
  const headerApiKey = req.headers['x-api-key'];
  const queryApiKey = req.query.token || req.query['x-api-key'] || req.query.api_key || req.query.apiKey;
  const apiKey = headerApiKey || queryApiKey;
  
  if (!apiKey || apiKey !== config.app.adminApiKey) {
    logger.warn('Unauthorized access attempt to admin endpoint', {
      ip: req.ip,
      endpoint: req.originalUrl
    });
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Valid API key is required for admin endpoints'
    });
  }
  
  next();
};

// Apply admin authentication to all routes in this router
router.use(authenticateAdmin);

/**
 * @route   GET /api/admin/publishing/status
 * @desc    Get current publishing configuration status
 * @access  Private (Admin)
 */
router.get('/publishing/status', (req, res) => {
  try {
    const status = {
      autoPublishEnabled: publishingService.isAutoPublishEnabled(),
      lastPublishTime: publishingService.lastPublishTime > 0 
        ? new Date(publishingService.lastPublishTime).toISOString() 
        : null,
      pendingPublish: publishingService.pendingPublish,
      minPublishInterval: `${publishingService.minPublishInterval}ms`
    };
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Error getting publishing status:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/admin/publishing/enable
 * @desc    Enable automatic publishing
 * @access  Private (Admin)
 */
router.post('/publishing/enable', (req, res) => {
  try {
    publishingService.setAutoPublish(true);
    
    res.json({
      success: true,
      message: 'Automatic publishing has been enabled',
      data: {
        autoPublishEnabled: true
      }
    });
  } catch (error) {
    logger.error('Error enabling publishing:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error', 
      message: error.message
    });
  }
});

/**
 * @route   POST /api/admin/publishing/disable
 * @desc    Disable automatic publishing
 * @access  Private (Admin)
 */
router.post('/publishing/disable', (req, res) => {
  try {
    publishingService.setAutoPublish(false);
    
    res.json({
      success: true,
      message: 'Automatic publishing has been disabled',
      data: {
        autoPublishEnabled: false
      }
    });
  } catch (error) {
    logger.error('Error disabling publishing:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/admin/publishing/publish
 * @desc    Force publish all site changes
 * @access  Private (Admin)
 */
router.post('/publishing/publish', async (req, res) => {
  try {
    const reason = req.body.reason || 'Manual publish via admin API';
    const result = await publishingService.forcePublish(reason);
    
    res.json({
      success: true,
      message: 'Site changes have been published successfully',
      data: {
        publishTime: result.publishedOn || new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error force publishing site changes:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/admin/webflow/site
 * @desc    Get Webflow site information
 * @access  Private (Admin)
 */
router.get('/webflow/site', async (req, res) => {
  try {
    const site = await webflowAPI.getSite();
    
    res.json({
      success: true,
      data: site
    });
  } catch (error) {
    logger.error('Error getting Webflow site information:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/admin/webflow/collections
 * @desc    Get all Webflow collections
 * @access  Private (Admin)
 */
router.get('/webflow/collections', async (req, res) => {
  try {
    const collections = await webflowAPI.getCollections();
    
    res.json({
      success: true,
      data: collections
    });
  } catch (error) {
    logger.error('Error getting Webflow collections:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/admin/sync/state
 * @desc    Get current sync state
 * @access  Private
 */
router.get('/sync/state', (req, res) => {
  try {
    const syncState = syncStateStore.loadSyncState();
    
    res.json({
      success: true,
      data: syncState
    });
  } catch (error) {
    logger.error('Error retrieving sync state:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/admin/sync/reset
 * @desc    Reset sync state
 * @access  Private
 */
router.post('/sync/reset', (req, res) => {
  try {
    const resetState = syncStateStore.resetSyncState();
    
    res.json({
      success: true,
      message: 'Sync state reset successfully',
      data: resetState
    });
  } catch (error) {
    logger.error('Error resetting sync state:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/admin/sync/test-incremental
 * @desc    Test incremental sync with a specific datetime
 * @access  Private
 */
router.post('/sync/test-incremental', async (req, res) => {
  try {
    const { timestamp } = req.body;
    let testTimestamp = timestamp;
    
    // If no timestamp provided, use a timestamp from 24 hours ago
    if (!testTimestamp) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      testTimestamp = yesterday.toISOString();
    }
    
    logger.info(`Testing incremental sync with timestamp: ${testTimestamp}`);
    
    // Test the Mysolution API with the provided timestamp
    const jobs = await mysolutionAPI.getChangedJobs(testTimestamp);
    
    // Get current jobs from Webflow for comparison
    const webflowJobsResponse = await webflowAPI.getJobs();
    const webflowJobs = webflowJobsResponse.items || [];
    
    res.json({
      success: true,
      message: `Successfully tested incremental sync with timestamp: ${testTimestamp}`,
      data: {
        timestamp: testTimestamp,
        jobsCount: jobs.length,
        webflowJobsCount: webflowJobs.length,
        // Include sample job data for analysis if available
        sampleJob: jobs.length > 0 ? jobs[0] : null
      }
    });
  } catch (error) {
    logger.error('Error testing incremental sync:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/admin/sync/run-incremental
 * @desc    Run incremental sync manually
 * @access  Private
 */
router.post('/sync/run-incremental', async (req, res) => {
  try {
    logger.info('Manually running incremental job sync');
    
    // Run the incremental sync
    const result = await incrementalJobsSync();
    
    res.json({
      success: true,
      message: 'Incremental sync completed successfully',
      data: result
    });
  } catch (error) {
    logger.error('Error running incremental sync:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/admin/jobs/count
 * @desc    Get job counts from both systems
 * @access  Private (Admin)
 */
router.get('/jobs/count', async (req, res) => {
  try {
    // Use cache for dashboard if requested
    const useCache = req.query.cache === 'dashboard';
    const cacheKey = 'job_counts';
    const cacheTTL = 5 * 60 * 1000; // 5 minutes
    
    // Check if we can use cached data
    if (useCache) {
      const cachedData = req.app.locals[cacheKey];
      if (cachedData && (Date.now() - cachedData.timestamp < cacheTTL)) {
        return res.json({
          success: true,
          data: cachedData.data,
          cached: true
        });
      }
    }
    
    // Fetch data from both systems
    const webflowJobs = await webflowAPI.getAllJobs().catch(() => []);
    const webflowJobCount = webflowJobs.length;
    
    const mysolutionJobs = await mysolutionAPI.getJobs().catch(() => []);
    const mysolutionJobCount = mysolutionJobs.length;
    
    const data = {
      mysolution: mysolutionJobCount,
      webflow: webflowJobCount,
      timestamp: new Date().toISOString()
    };
    
    // Cache the data for dashboard
    if (useCache) {
      req.app.locals[cacheKey] = {
        data,
        timestamp: Date.now()
      };
    }
    
    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Error getting job counts:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/admin/sync/status
 * @desc    Get current sync status
 * @access  Private (Admin)
 */
router.get('/sync/status', (req, res) => {
  try {
    // Check if request has a cache marker to reduce processing
    const cacheMarker = req.query.cache;
    
    // Return cached data for dashboard polling requests
    if (cacheMarker === 'dashboard') {
      // Use cached sync status if available in memory and not older than 1 minute
      const cachedData = router.cachedSyncStatus;
      const cacheAge = router.cachedSyncStatusTime ? (Date.now() - router.cachedSyncStatusTime) : Infinity;
      
      if (cachedData && cacheAge < 60000) { // 1 minute cache
        return res.json({
          success: true,
          data: cachedData,
          cached: true
        });
      }
    }
    
    // Get sync state from store
    const syncState = syncStateStore.getSyncState();
    
    // Get separate sync times from localStorage-like persistent storage
    // We'll check if sync state has separate tracking, otherwise use general lastSync
    const lastFullSyncTime = syncState.lastFullSync || null;
    const lastIncrementalSyncTime = syncState.lastIncrementalSync || syncState.lastSync || null;
    
    // Cache the results
    router.cachedSyncStatus = {
      lastSync: syncState.lastSync,
      lastFullSync: lastFullSyncTime,
      lastIncrementalSync: lastIncrementalSyncTime,
      syncCount: syncState.syncCount,
      lastError: syncState.lastError ? {
        message: syncState.lastError.message,
        time: syncState.lastError.time
      } : null,
      jobCount: Object.keys(syncState.jobModificationDates || {}).length
    };
    router.cachedSyncStatusTime = Date.now();
    
    res.json({
      success: true,
      data: router.cachedSyncStatus
    });
  } catch (error) {
    logger.error('Error getting sync status:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/admin/sync/schedule/status
 * @desc    Get sync schedule configuration
 * @access  Private (Admin)
 */
router.get('/sync/schedule/status', (req, res) => {
  try {
    // Get interval in minutes from config
    const intervalMs = config.sync.interval;
    const intervalMinutes = Math.ceil(intervalMs / 60000);
    
    const scheduleData = {
      enabled: config.sync.enableScheduledSync,
      interval: intervalMinutes,
      intervalMs: intervalMs,
      fullSyncTime: '07:00',
      fullSyncCron: '0 7 * * *',
      incrementalSyncCron: `*/${intervalMinutes} * * * *`
    };
    
    res.json({
      success: true,
      data: scheduleData
    });
  } catch (error) {
    logger.error('Error getting sync schedule:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/admin/sync/schedule/enable
 * @desc    Enable scheduled syncing
 * @access  Private (Admin)
 */
router.post('/sync/schedule/enable', (req, res) => {
  config.sync.enableScheduledSync = true;
  
  // Start both schedulers if they exist
  if (global.scheduledJobsSync) {
    global.scheduledJobsSync.start();
  }
  
  if (global.scheduledFullJobsSync) {
    global.scheduledFullJobsSync.start();
  }
  
  // Get cron patterns from the global scheduler objects
  const incrementalCronPattern = global.scheduledJobsSync?.options?.scheduled?.cron || 
                     `*/${config.sync.syncIntervalMinutes} * * * *`;
  const fullSyncCronPattern = global.scheduledFullJobsSync?.options?.scheduled?.cron ||
                     '0 7 * * *'; // Daily at 7 AM
                     
  res.json({
    success: true,
    message: 'Scheduled syncing enabled',
    data: {
      enabled: config.sync.enableScheduledSync,
      interval: config.sync.syncIntervalMinutes,
      incrementalCronPattern: incrementalCronPattern,
      fullSyncCronPattern: fullSyncCronPattern
    }
  });
});

/**
 * @route   POST /api/admin/sync/schedule/disable
 * @desc    Disable scheduled syncing
 * @access  Private (Admin)
 */
router.post('/sync/schedule/disable', (req, res) => {
  config.sync.enableScheduledSync = false;
  
  // Stop both schedulers if they exist
  if (global.scheduledJobsSync) {
    global.scheduledJobsSync.stop();
  }
  
  if (global.scheduledFullJobsSync) {
    global.scheduledFullJobsSync.stop();
  }
  
  // Get cron patterns from the global scheduler objects
  const incrementalCronPattern = global.scheduledJobsSync?.options?.scheduled?.cron || 
                     `*/${config.sync.syncIntervalMinutes} * * * *`;
  const fullSyncCronPattern = global.scheduledFullJobsSync?.options?.scheduled?.cron ||
                     '0 7 * * *'; // Daily at 7 AM
  
  res.json({
    success: true,
    message: 'Scheduled syncing disabled',
    data: {
      enabled: config.sync.enableScheduledSync,
      interval: config.sync.syncIntervalMinutes,
      incrementalCronPattern: incrementalCronPattern,
      fullSyncCronPattern: fullSyncCronPattern
    }
  });
});

/**
 * @route   GET /api/admin/deployment/info
 * @desc    Get deployment information including commit time
 * @access  Private (Admin)
 */
router.get('/deployment/info', async (req, res) => {
  try {
    const deploymentInfo = await getDeploymentInfo();
    
    res.json({
      success: true,
      data: deploymentInfo
    });
  } catch (error) {
    logger.error('Error getting deployment info:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

// NOTE: Cron endpoints have been moved to src/index.js 
// to be directly accessible at /api/cron/ as required by Vercel

/**
 * @route   POST /api/admin/test-cron-sync
 * @desc    Test endpoint to manually trigger cron sync logic (for testing)
 * @access  Private (Admin)
 */
router.post('/test-cron-sync', async (req, res) => {
  try {
    const syncType = req.body.type || 'incremental'; // 'incremental' or 'full'
    
    if (syncType === 'full') {
      const syncId = `test-full-sync-${Date.now()}`;
      logger.info('Running TEST full jobs sync', { syncId });
      
      const result = await jobsSync();
      
      logger.info('TEST full jobs sync completed successfully', { 
        syncId, 
        result: {
          processedJobs: result.processedJobs || 0,
          newJobs: result.newJobs || 0,
          updatedJobs: result.updatedJobs || 0,
          duration: result.duration || 'unknown'
        }
      });
      
      res.json({ 
        success: true, 
        message: 'Test full sync completed successfully',
        syncId,
        result
      });
      
    } else {
      const syncId = `test-incremental-sync-${Date.now()}`;
      logger.info('Running TEST incremental jobs sync', { syncId });
      
      const result = await incrementalJobsSync();
      
      logger.info('TEST incremental jobs sync completed successfully', { 
        syncId, 
        result: {
          processedJobs: result.processedJobs || 0,
          newJobs: result.newJobs || 0,
          updatedJobs: result.updatedJobs || 0,
          duration: result.duration || 'unknown'
        }
      });
      
      res.json({ 
        success: true, 
        message: 'Test incremental sync completed successfully',
        syncId,
        result
      });
    }
    
  } catch (error) {
    const syncId = `test-sync-error-${Date.now()}`;
    logger.error('Error in TEST sync', { 
      syncId, 
      error: error.message, 
      stack: error.stack 
    });
    
    res.status(500).json({ 
      success: false, 
      error: 'Error during test sync',
      syncId,
      message: error.message
    });
  }
});

export default router; 