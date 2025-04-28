import express from 'express';
import { logger } from '../utils/logger.js';
import { jobsSync } from '../services/jobsSync.js';
import mysolutionAPI from '../api/mysolution.js';
import webflowAPI from '../api/webflow.js';

const router = express.Router();

/**
 * @route   GET /api/jobs
 * @desc    Get all jobs
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    const source = req.query.source || 'mysolution';
    
    if (source === 'webflow') {
      const webflowJobs = await webflowAPI.getJobs();
      return res.json({
        success: true,
        count: webflowJobs.items ? webflowJobs.items.length : 0,
        data: webflowJobs
      });
    } else {
      const mysolutionJobs = await mysolutionAPI.getJobs();
      return res.json({
        success: true,
        count: mysolutionJobs.length,
        data: mysolutionJobs
      });
    }
  } catch (error) {
    logger.error('Error fetching jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/jobs/:id
 * @desc    Get a single job by ID
 * @access  Public
 */
router.get('/:id', async (req, res) => {
  try {
    const source = req.query.source || 'mysolution';
    const id = req.params.id;
    
    if (source === 'webflow') {
      const webflowJob = await webflowAPI.getJob(id);
      return res.json({
        success: true,
        data: webflowJob
      });
    } else {
      const mysolutionJob = await mysolutionAPI.getJobById(id);
      return res.json({
        success: true,
        data: mysolutionJob
      });
    }
  } catch (error) {
    logger.error(`Error fetching job ${req.params.id}:`, error);
    
    // Handle 404 errors specifically
    if (error.response && error.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Job with ID ${req.params.id} not found`
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   POST /api/jobs/sync
 * @desc    Manually trigger job synchronization
 * @access  Private
 */
router.post('/sync', async (req, res) => {
  const routeId = `api-sync-${Date.now()}`;
  try {
    logger.info('Manual sync request received', { routeId });
    const result = await jobsSync();
    
    logger.info('Manual sync completed successfully', { routeId, result });
    res.json({
      success: true,
      message: 'Job synchronization completed successfully',
      data: result
    });
  } catch (error) {
    logger.error('Error during manual job sync:', { 
      routeId, 
      error: error.message,
      stack: error.stack 
    });
    
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

export default router; 