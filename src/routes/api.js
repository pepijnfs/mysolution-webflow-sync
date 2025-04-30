import express from 'express';
import { logger } from '../utils/logger.js';
import { processNewCandidate, processJobApplication } from '../services/candidatesSync.js';
import multer from 'multer';

const router = express.Router();

// Set up multer for memory storage (for handling file uploads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

/**
 * @route   POST /api/candidates/apply
 * @desc    Process a job application from Webflow
 * @access  Public
 */
router.post('/candidates/apply', async (req, res) => {
  try {
    logger.info('Received job application from Webflow form handler');
    
    const formData = req.body;
    const jobId = formData['job-id'];
    
    if (!jobId) {
      logger.error('No job ID provided in application');
      return res.status(400).json({
        success: false,
        error: 'Job ID is required. Please ensure the vacancy ID is properly set.'
      });
    }
    
    // Process the application
    const result = await processJobApplication(jobId, formData);
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Application submitted successfully'
      });
    } else {
      // Important: Return detailed error message for display on the form
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to process application'
      });
    }
  } catch (error) {
    logger.error('Error processing job application:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
});

/**
 * @route   POST /api/candidates/apply/:jobId
 * @desc    Process a job application with a specific job ID (file upload version)
 * @access  Public
 */
router.post('/candidates/apply/:jobId', upload.single('cv'), async (req, res) => {
  try {
    const jobId = req.params.jobId;
    logger.info(`Received job application from Webflow for job ${jobId}`);
    
    // Get form data from request body
    const formData = { ...req.body };
    
    // Add the file if it was uploaded
    if (req.file) {
      formData.cv = req.file;
    }
    
    // Add job ID to form data
    formData['job-id'] = jobId;
    
    // Process the application
    const result = await processJobApplication(jobId, formData);
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Application submitted successfully'
      });
    } else {
      // Important: Return detailed error message for display on the form
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to process application'
      });
    }
  } catch (error) {
    logger.error(`Error processing job application for job ${req.params.jobId}:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred'
    });
  }
});

export default router; 