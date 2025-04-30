import express from 'express';
import { logger } from '../utils/logger.js';
import { processNewCandidate } from '../services/candidatesSync.js';
import { jobsSync } from '../services/jobsSync.js';
import multer from 'multer';

const router = express.Router();

// Explicitly add urlencoded parsing before routes
// This ensures it is applied in the correct order for this router
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// Setup multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Check if the file is a PDF, DOC, DOCX, or TXT
    if (file.fieldname === 'cv') {
      const allowedMimeTypes = [
        'application/pdf', // PDF
        'application/msword', // DOC
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
        'text/plain' // TXT
      ];
      
      if (allowedMimeTypes.includes(file.mimetype)) {
        // Accept the file
        return cb(null, true);
      } else {
        // Reject the file
        return cb(new Error('Only PDF, DOC, DOCX, and TXT files are allowed for CV uploads.'), false);
      }
    }
    
    // For other file fields, accept all
    cb(null, true);
  }
});

/**
 * @route   POST /api/webhooks/webflow/form
 * @desc    Handle Webflow form submissions (supports both multipart and urlencoded)
 * @access  Public
 */
router.post('/webflow/form', upload.single('cv'), async (req, res) => {
  try {
    // Log the raw request for debugging
    logRawRequest(req);
    
    // Log detailed request information
    logger.info('Received Webflow form submission webhook with details:', {
      contentType: req.headers['content-type'],
      method: req.method,
      path: req.path,
      bodyKeys: Object.keys(req.body),
      bodySize: req.body ? Object.keys(req.body).length : 0,
      query: req.query,
      file: req.file ? {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : null
    });
    
    // Check if body is empty
    if (!req.body || Object.keys(req.body).length === 0) {
      logger.error('No form data received in request body');
      return res.status(400).json({
        success: false,
        error: 'Missing Form Data',
        message: 'No form data was received in the request body'
      });
    }
    
    // Process the form submission using the shared function
    await handleWebflowFormSubmission(req, res);
  } catch (error) {
    // Log detailed error information
    logger.error('Error in Webflow webhook handler:', {
      error: error.message,
      stack: error.stack,
      type: error.name
    });
    
    handleFormError(error, res);
  }
});

/**
 * @route   POST /api/webhooks/webflow/form-urlencoded
 * @desc    Handle Webflow form submissions (application/x-www-form-urlencoded without file)
 * @access  Public
 */
router.post('/webflow/form-urlencoded', async (req, res) => {
  try {
    logger.info('Received Webflow form submission webhook (urlencoded)');
    logger.info('Redirecting to main webhook handler');
    
    // Log detailed request information
    logger.info('Webhook details:', {
      contentType: req.headers['content-type'],
      bodyKeys: Object.keys(req.body),
      body: req.body
    });
    
    // Use the same handler as the main endpoint
    await handleWebflowFormSubmission(req, res);
  } catch (error) {
    handleFormError(error, res);
  }
});

/**
 * @route   GET /api/webhooks/webflow/form
 * @desc    Test endpoint to verify webhook URL is accessible
 * @access  Public
 */
router.get('/webflow/form', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Webhook endpoint is configured and ready to receive Webflow form submissions',
    instructions: 'This endpoint is designed to receive POST requests from Webflow forms, not GET requests'
  });
});

/**
 * Handle Webflow form submission webhook
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleWebflowFormSubmission(req, res) {
  const { body } = req;
  
  // Check if this is actually a webhook or a direct form submission
  // Webhooks typically contain a data object with the submission
  // Direct forms just send the form data directly
  let formData;
  
  if (body._meta && body.data) {
    // This is a webhook format
    logger.info('Received Webflow webhook form submission');
    formData = body.data;
  } else {
    // This is likely a direct form submission
    logger.info('Received direct form submission');
    formData = body;
  }
  
  // Log the form data for debugging
  logger.debug('Form data received:', { 
    fields: Object.keys(formData),
    endpoint: req.originalUrl
  });
  
  // Process the candidate application
  try {
    const result = await processNewCandidate(formData);
    
    // Return the result
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error('Error processing form webhook:', error);
    res.status(500).json({
      success: false,
      error: `Server error processing form submission: ${error.message}`
    });
  }
}

// Handle form submission errors
function handleFormError(error, res) {
  logger.error('Error processing Webflow webhook:', error);
  
  // Log the full error stack trace and details for debugging
  console.error('Full error details:', {
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code,
  });
  
  // Return proper error response
  return res.status(500).json({
    success: false,
    error: 'Server Error',
    message: error.message,
    errorType: error.name,
    errorCode: error.code
  });
}

// Add a function to log the raw request for debugging
function logRawRequest(req) {
  try {
    logger.info('Raw request details:', {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: typeof req.body === 'object' ? JSON.stringify(req.body) : req.body,
      query: req.query,
      params: req.params,
      ip: req.ip,
      path: req.path
    });
  } catch (e) {
    logger.error('Error logging raw request:', e);
  }
}

/**
 * @route   POST /api/webhooks/mysolution/job
 * @desc    Handle Mysolution job update webhooks
 * @access  Private
 */
router.post('/mysolution/job', async (req, res) => {
  try {
    logger.info('Received Mysolution job webhook');
    
    // Validate webhook
    const eventType = req.body.event;
    
    if (!eventType) {
      logger.error('Invalid Mysolution webhook: Missing event type');
      return res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: 'Invalid Mysolution webhook: Missing event type'
      });
    }
    
    logger.info(`Processing Mysolution webhook for event: ${eventType}`);
    
    // Handle job events (created, updated, deleted)
    if (eventType.includes('job')) {
      // For any job-related event, trigger a jobs sync
      // This is a simplified approach; in a production system, 
      // you might want to sync only the affected job for efficiency
      const result = await jobsSync();
      
      logger.info('Jobs sync completed after receiving Mysolution webhook');
      return res.status(200).json({
        success: true,
        message: 'Webhook processed successfully',
        data: result
      });
    } else {
      // Handle other event types or return error
      logger.warn(`Unhandled Mysolution event type: ${eventType}`);
      return res.status(400).json({
        success: false,
        error: 'Unsupported Event',
        message: `Event type '${eventType}' is not supported`
      });
    }
  } catch (error) {
    logger.error('Error processing Mysolution webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Server Error',
      message: error.message
    });
  }
});

/**
 * @route   GET /api/webhooks/status
 * @desc    Check the status of the webhook service
 * @access  Public
 */
router.get('/status', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Webhook service is running',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString()
  });
});

export default router; 