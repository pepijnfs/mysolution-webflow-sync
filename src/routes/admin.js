import express from 'express';
import { logger } from '../utils/logger.js';
import publishingService from '../services/publishingService.js';
import webflowAPI from '../api/webflow.js';
import config from '../utils/config.js';
import mysolutionAPI from '../api/mysolution.js';
import syncStateStore from '../utils/syncStateStore.js';
import { incrementalJobsSync, jobsSync } from '../services/jobsSync.js';
import auth from '../utils/auth.js';

const router = express.Router();

// Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
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
 * @desc    Get counts of jobs in Mysolution and Webflow
 * @access  Private (Admin)
 */
router.get('/jobs/count', async (req, res) => {
  try {
    // Get count of jobs in Webflow
    const webflowJobsResponse = await webflowAPI.getJobs();
    const webflowJobCount = webflowJobsResponse.items ? webflowJobsResponse.items.length : 0;
    
    // Get count of jobs in Mysolution
    const mysolutionJobs = await mysolutionAPI.getJobs();
    const mysolutionJobCount = mysolutionJobs ? mysolutionJobs.length : 0;
    
    res.json({
      success: true,
      data: {
        webflow: webflowJobCount,
        mysolution: mysolutionJobCount
      }
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
    // Get sync state from store
    const syncState = syncStateStore.getSyncState();
    
    res.json({
      success: true,
      data: {
        lastSync: syncState.lastSync,
        syncCount: syncState.syncCount,
        lastError: syncState.lastError ? {
          message: syncState.lastError.message,
          time: syncState.lastError.time
        } : null,
        jobCount: Object.keys(syncState.jobModificationDates || {}).length
      }
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
 * @desc    Get status of scheduled syncing
 * @access  Private (Admin)
 */
router.get('/sync/schedule/status', (req, res) => {
  // For the cron patterns, try to get them from the global scheduler objects
  const incrementalCronPattern = global.scheduledJobsSync?.options?.scheduled?.cron || 
                     `*/${config.sync.syncIntervalMinutes} * * * *`;
  const fullSyncCronPattern = global.scheduledFullJobsSync?.options?.scheduled?.cron ||
                     '0 7 * * *'; // Daily at 7 AM
  
  const status = {
    success: true,
    data: {
      enabled: config.sync.enableScheduledSync,
      interval: config.sync.syncIntervalMinutes,
      incrementalCronPattern: incrementalCronPattern,
      fullSyncCronPattern: fullSyncCronPattern
    }
  };
  res.json(status);
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

export default router; 